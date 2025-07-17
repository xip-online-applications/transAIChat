const { z } = require('zod');
const { tool } = require('@langchain/core/tools');
const { logger } = require('@librechat/data-schemas');
const { Time, CacheKeys, StepTypes } = require('librechat-data-provider');
const { sendEvent, normalizeServerName, MCPOAuthHandler } = require('@librechat/api');
const { Constants: AgentConstants, Providers, GraphEvents } = require('@librechat/agents');
const {
  Constants,
  ContentTypes,
  isAssistantsEndpoint,
  convertJsonSchemaToZod,
} = require('librechat-data-provider');
const { getMCPManager, getFlowStateManager } = require('~/config');
const { findToken, createToken, updateToken } = require('~/models');
const { getCachedTools } = require('./Config');
const { getLogStores } = require('~/cache');
const ToolPermissionManager = require('~/server/services/ToolPermissionManager');

/**
 * @param {object} params
 * @param {ServerResponse} params.res - The Express response object for sending events.
 * @param {string} params.stepId - The ID of the step in the flow.
 * @param {ToolCallChunk} params.toolCall - The tool call object containing tool information.
 * @param {string} params.loginFlowId - The ID of the login flow.
 * @param {FlowStateManager<any>} params.flowManager - The flow manager instance.
 */
function createOAuthStart({ res, stepId, toolCall, loginFlowId, flowManager, signal }) {
  /**
   * Creates a function to handle OAuth login requests.
   * @param {string} authURL - The URL to redirect the user for OAuth authentication.
   * @returns {Promise<boolean>} Returns true to indicate the event was sent successfully.
   */
  return async function (authURL) {
    /** @type {{ id: string; delta: AgentToolCallDelta }} */
    const data = {
      id: stepId,
      delta: {
        type: StepTypes.TOOL_CALLS,
        tool_calls: [{ ...toolCall, args: '' }],
        auth: authURL,
        expires_at: Date.now() + Time.TWO_MINUTES,
      },
    };
    /** Used to ensure the handler (use of `sendEvent`) is only invoked once */
    await flowManager.createFlowWithHandler(
      loginFlowId,
      'oauth_login',
      async () => {
        sendEvent(res, { event: GraphEvents.ON_RUN_STEP_DELTA, data });
        logger.debug('Sent OAuth login request to client');
        return true;
      },
      signal,
    );
  };
}

/**
 * @param {object} params
 * @param {ServerResponse} params.res - The Express response object for sending events.
 * @param {string} params.stepId - The ID of the step in the flow.
 * @param {ToolCallChunk} params.toolCall - The tool call object containing tool information.
 * @param {string} params.loginFlowId - The ID of the login flow.
 * @param {FlowStateManager<any>} params.flowManager - The flow manager instance.
 */
function createOAuthEnd({ res, stepId, toolCall }) {
  return async function () {
    /** @type {{ id: string; delta: AgentToolCallDelta }} */
    const data = {
      id: stepId,
      delta: {
        type: StepTypes.TOOL_CALLS,
        tool_calls: [{ ...toolCall }],
      },
    };
    sendEvent(res, { event: GraphEvents.ON_RUN_STEP_DELTA, data });
    logger.debug('Sent OAuth login success to client');
  };
}

/**
 * @param {object} params
 * @param {string} params.userId - The ID of the user.
 * @param {string} params.serverName - The name of the server.
 * @param {string} params.toolName - The name of the tool.
 * @param {FlowStateManager<any>} params.flowManager - The flow manager instance.
 */
function createAbortHandler({ userId, serverName, toolName, flowManager }) {
  return function () {
    logger.info(`[MCP][User: ${userId}][${serverName}][${toolName}] Tool call aborted`);
    const flowId = MCPOAuthHandler.generateFlowId(userId, serverName);
    flowManager.failFlow(flowId, 'mcp_oauth', new Error('Tool call aborted'));
  };
}

/**
 * Creates a general tool for an entire action set.
 *
 * @param {Object} params - The parameters for loading action sets.
 * @param {ServerRequest} params.req - The Express request object, containing user/request info.
 * @param {ServerResponse} params.res - The Express response object for sending events.
 * @param {string} params.toolKey - The toolKey for the tool.
 * @param {import('@librechat/agents').Providers | EModelEndpoint} params.provider - The provider for the tool.
 * @param {string} params.model - The model for the tool.
 * @returns { Promise<typeof tool | { _call: (toolInput: Object | string) => unknown}> } An object with `_call` method to execute the tool input.
 */
async function createMCPTool({ req, res, toolKey, provider: _provider }) {
  const availableTools = await getCachedTools({ includeGlobal: true });
  const toolDefinition = availableTools?.[toolKey]?.function;
  if (!toolDefinition) {
    logger.error(`Tool ${toolKey} not found in available tools`);
    return null;
  }
  /** @type {LCTool} */
  const { description, parameters } = toolDefinition;
  const isGoogle = _provider === Providers.VERTEXAI || _provider === Providers.GOOGLE;
  let schema = convertJsonSchemaToZod(parameters, {
    allowEmptyObject: !isGoogle,
    transformOneOfAnyOf: true,
  });

  if (!schema) {
    schema = z.object({ input: z.string().optional() });
  }

  const [toolName, serverName] = toolKey.split(Constants.mcp_delimiter);
  const normalizedToolKey = `${toolName}${Constants.mcp_delimiter}${normalizeServerName(serverName)}`;

  if (!req.user?.id) {
    logger.error(
      `[MCP][${serverName}][${toolName}] User ID not found on request. Cannot create tool.`,
    );
    throw new Error(`User ID not found on request. Cannot create tool for ${toolKey}.`);
  }

  /** @type {(toolArguments: Object | string, config?: GraphRunnableConfig) => Promise<unknown>} */
  const _call = async (toolArguments, config) => {
    logger.info(
      `[MCP][User: ${req.user.id}][${serverName}][${toolName}] Requesting user permission`,
    );

    // Human-in-the-loop permission check
    const permissionId = `${normalizedToolKey}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const userId = config?.configurable?.user?.id || config?.configurable?.user_id;
    const permissionKey = `${permissionId}:${userId}`;
    const toolRequest = {
      toolId: normalizedToolKey,
      toolName,
      toolDescription: description,
      permissionId,
      userId,
      messageId: config?.metadata?.messageId,
    };
    // Await user permission using global manager, and emit SSE event
    const granted = await ToolPermissionManager.requestPermission(
      permissionKey,
      toolRequest,
      (event, data) => sendEvent(res, { event, data })
    );
    if (!granted) {
      logger.warn(
        `[MCP][User: ${req.user.id}][${serverName}][${toolName}] Tool call denied by user`,
      );
      return ["Tool call denied by user, do not attempt to use this tool again.", null];
    }

    logger.info(
      `[MCP][User: ${req.user.id}][${serverName}][${toolName}] User permission granted, proceeding with tool call`,
    );

    /** @type {ReturnType<typeof createAbortHandler>} */
    let abortHandler = null;
    /** @type {AbortSignal} */
    let derivedSignal = null;

    try {
      const flowsCache = getLogStores(CacheKeys.FLOWS);
      const flowManager = getFlowStateManager(flowsCache);
      derivedSignal = config?.signal ? AbortSignal.any([config.signal]) : undefined;
      const mcpManager = getMCPManager(userId);
      const provider = (config?.metadata?.provider || _provider)?.toLowerCase();
      toolArguments = {
        ...toolArguments,
        token: req.headers.authorization,
      };
      const { args: _args, stepId, ...toolCall } = config.toolCall ?? {};
      const loginFlowId = `${serverName}:oauth_login:${config.metadata.thread_id}:${config.metadata.run_id}`;
      const oauthStart = createOAuthStart({
        res,
        stepId,
        toolCall,
        loginFlowId,
        flowManager,
        signal: derivedSignal,
      });
      const oauthEnd = createOAuthEnd({
        res,
        stepId,
        toolCall,
      });

      if (derivedSignal) {
        abortHandler = createAbortHandler({ userId, serverName, toolName, flowManager });
        derivedSignal.addEventListener('abort', abortHandler, { once: true });
      }

      const customUserVars =
        config?.configurable?.userMCPAuthMap?.[`${Constants.mcp_prefix}${serverName}`];

      const result = await mcpManager.callTool({
        serverName,
        toolName,
        provider,
        toolArguments,
        options: {
          signal: derivedSignal,
        },
        user: config?.configurable?.user,
        customUserVars,
        flowManager,
        tokenMethods: {
          findToken,
          createToken,
          updateToken,
        },
        oauthStart,
        oauthEnd,
      });

      if (isAssistantsEndpoint(provider) && Array.isArray(result)) {
        return result[0];
      }
      if (isGoogle && Array.isArray(result[0]) && result[0][0]?.type === ContentTypes.TEXT) {
        return [result[0][0].text, result[1]];
      }
      return result;
    } catch (error) {
      logger.error(
        `[MCP][User: ${userId}][${serverName}] Error calling "${toolName}" MCP tool:`,
        error,
      );

      /** OAuth error, provide a helpful message */
      const isOAuthError =
        error.message?.includes('401') ||
        error.message?.includes('OAuth') ||
        error.message?.includes('authentication') ||
        error.message?.includes('Non-200 status code (401)');

      if (isOAuthError) {
        throw new Error(
          `OAuth authentication required for ${serverName}. Please check the server logs for the authentication URL.`,
        );
      }

      throw new Error(
        `"${toolKey}" tool call failed${error?.message ? `: ${error?.message}` : '.'}`,
      );
    } finally {
      // Clean up abort handler to prevent memory leaks
      if (abortHandler && derivedSignal) {
        derivedSignal.removeEventListener('abort', abortHandler);
      }
    }
  };

  const toolInstance = tool(_call, {
    schema,
    name: normalizedToolKey,
    description: description || '',
    responseFormat: AgentConstants.CONTENT_AND_ARTIFACT,
  });
  toolInstance.mcp = true;
  return toolInstance;
}

module.exports = {
  createMCPTool,
};
