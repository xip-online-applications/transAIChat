import React from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';

interface ToolPermissionModalProps {
  open: boolean;
  toolName: string;
  toolDescription?: string;
  onGrant: () => void;
  onDeny: () => void;
}

const ToolPermissionModal: React.FC<ToolPermissionModalProps> = ({
  open,
  toolName,
  toolDescription,
  onGrant,
  onDeny,
}) => {
  if (!open) return null;

  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isDark ? 'bg-black bg-opacity-70' : 'bg-black bg-opacity-50'}`}>
      <div className={`${isDark ? 'bg-gray-900 text-white' : 'bg-white text-black'} rounded-lg shadow-lg p-6 max-w-md w-full`}>
        <h2 className="text-lg font-bold mb-2">Tool Permission Required</h2>
        <p className="mb-4">
          The agent wants to use the tool: <span className="font-semibold">{toolName}</span>
        </p>
        {toolDescription && (
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{toolDescription}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className={`px-4 py-2 rounded hover:bg-gray-300 ${isDark ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-200'}`}
            onClick={onDeny}
          >
            Deny
          </button>
          <button
            className={`px-4 py-2 rounded ${isDark ? 'bg-blue-700 text-white hover:bg-blue-800' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            onClick={onGrant}
          >
            Grant Permission
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToolPermissionModal;
