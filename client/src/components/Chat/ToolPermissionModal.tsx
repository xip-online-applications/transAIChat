import React from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';

interface ToolPermissionModalProps {
  open: boolean;
  toolName: string;
  toolDescription?: string;
  toolInput?: any;
  onGrant: () => void;
  onDeny: (reason?: string) => void;
  queueLength?: number;
  queueIndex?: number;
}

const ToolPermissionModal: React.FC<ToolPermissionModalProps> = ({
  open,
  toolName,
  toolDescription,
  toolInput,
  onGrant,
  onDeny,
  queueLength = 1,
  queueIndex = 0,
}) => {
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [buttonsDisabled, setButtonsDisabled] = React.useState(false);
  const [showReasonInput, setShowReasonInput] = React.useState(false);
  const [reason, setReason] = React.useState('');
  if (!open) return null;

  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const handleGrantClick = () => {
    setButtonsDisabled(true);
    setFeedback('Permission granted. Loading next request...');
    setTimeout(() => {
      setFeedback(null);
      setButtonsDisabled(false);
      onGrant();
    }, 700);
  };

  const handleDenyClick = () => {
    if (!showReasonInput) {
      setShowReasonInput(true);
      return;
    }
    setButtonsDisabled(true);
    setFeedback('Permission denied. Loading next request...');
    setTimeout(() => {
      setFeedback(null);
      setButtonsDisabled(false);
      onDeny(reason);
      setReason('');
      setShowReasonInput(false);
    }, 700);
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isDark ? 'bg-black bg-opacity-70' : 'bg-black bg-opacity-50'}`}>
      <div className={`${isDark ? 'bg-gray-900 text-white' : 'bg-white text-black'} rounded-lg shadow-lg p-6 max-w-md w-full`}>
        <h2 className="text-lg font-bold mb-2">Tool Permission Required</h2>
        <p className="mb-2 text-sm text-gray-400 dark:text-gray-500">
          Request {queueIndex + 1} of {queueLength}
        </p>
        <p className="mb-4">
          The agent wants to use the tool: <span className="font-semibold">{toolName}</span>
        </p>
        {/* Tool Description Dropdown */}
        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-300 underline">Show tool description</summary>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {toolDescription || 'No description provided.'}
          </div>
        </details>
        {/* Tool Input Dropdown */}
        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-300 underline">Show tool input</summary>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {typeof toolInput !== 'undefined'
              ? JSON.stringify(toolInput, null, 2)
              : 'No input provided.'}
          </div>
        </details>
        {showReasonInput && (
          <div className="mb-4">
            <label className="block mb-1 text-sm" htmlFor="deny-reason">Reason for denial (optional):</label>
            <input
              id="deny-reason"
              type="text"
              className={`w-full px-3 py-2 rounded border ${isDark ? 'bg-gray-800 text-white border-gray-700' : 'bg-gray-100 border-gray-300'}`}
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={buttonsDisabled}
              placeholder="You may provide a reason..."
            />
          </div>
        )}
        {feedback && <div className="mb-4 text-blue-500 dark:text-blue-400 text-sm">{feedback}</div>}
        <div className="flex justify-end gap-2">
          <button
            className={`px-4 py-2 rounded hover:bg-gray-300 ${isDark ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-200'}`}
            onClick={handleDenyClick}
            disabled={buttonsDisabled}
          >
            {showReasonInput ? 'Submit Denial' : 'Deny'}
          </button>
          <button
            className={`px-4 py-2 rounded ${isDark ? 'bg-blue-700 text-white hover:bg-blue-800' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            onClick={handleGrantClick}
            disabled={buttonsDisabled}
          >
            Grant Permission
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToolPermissionModal;
