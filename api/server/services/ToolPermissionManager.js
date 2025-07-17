// Global manager for human-in-the-loop tool permission requests
// Usage: ToolPermissionManager.requestPermission(runId, toolRequest) => Promise<boolean>
const { logger } = require('@librechat/data-schemas');

class ToolPermissionManager {
  static pendingRequests = new Map(); // key: `${permissionId}:${userId}`

  /**
   * Request permission for a tool. Returns a promise that resolves with the user's decision.
   * Only one request per permissionId:userId can be open at a time.
   * @param {string} key - `${permissionId}:${userId}`
   * @param {object} toolRequest
   * @param {function} emitSSE - Function to emit SSE event (e.g. (event, data) => void)
   * @returns {Promise<boolean>} true if granted, false if denied
   */
  static requestPermission(key, toolRequest, emitSSE) {
    logger.info(`[ToolPermissionManager] Received permission request for key: ${key}`);
    if (this.pendingRequests.has(key)) {
      throw new Error('A tool permission request is already pending for this key');
    }
    if (typeof emitSSE === 'function') {
      emitSSE('tool_permission_request', toolRequest);
      logger.info(`[ToolPermissionManager] Emitted tool_permission_request SSE event for key: ${key}`);
    }
    return new Promise((resolve) => {
      this.pendingRequests.set(key, { toolRequest, resolver: resolve });
    });
  }

  /**
   * Resolve a pending permission request for a tool.
   * @param {string} key - `${permissionId}:${userId}`
   * @param {boolean} granted
   * @returns {boolean} true if resolved, false if not found
   */
  static resolvePermission(key, granted) {
    const entry = this.pendingRequests.get(key);
    if (!entry) return false;
    entry.resolver(granted);
    this.pendingRequests.delete(key);
    return true;
  }

  /**
   * Get the pending request for a key (if any)
   * @param {string} key - `${permissionId}:${userId}`
   * @returns {object|null}
   */
  static getPendingRequest(key) {
    const entry = this.pendingRequests.get(key);
    return entry ? entry.toolRequest : null;
  }
}

module.exports = ToolPermissionManager;
