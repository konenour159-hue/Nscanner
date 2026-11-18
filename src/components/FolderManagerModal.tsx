import React, { useState } from 'react';
import { X, FolderPlus, Trash2, Edit2, Check, Folder } from 'lucide-react';
import { FolderItem } from '../types/scanner';

interface FolderManagerModalProps {
  folders: FolderItem[];
  onSaveFolder: (folder: FolderItem) => void;
  onDeleteFolder: (folderId: string) => void;
  onClose: () => void;
}

const COLOR_PALETTE = [
  '#7C3AED',
  '#2563EB',
  '#16A34A',
  '#D97706',
  '#8B5CF6',
  '#0891B2',
  '#EA580C',
  '#64748B',
];

export const FolderManagerModal: React.FC<FolderManagerModalProps> = ({
  folders,
  onSaveFolder,
  onDeleteFolder,
  onClose,
}) => {
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    const newFolder: FolderItem = {
      id: 'f_' + Date.now(),
      name: newFolderName.trim(),
      color: selectedColor,
      createdAt: Date.now(),
      isSystem: false,
    };

    onSaveFolder(newFolder);
    setNewFolderName('');
  }

  function handleStartEdit(folder: FolderItem) {
    setEditingId(folder.id);
    setEditName(folder.name);
  }

  function handleSaveEdit(folder: FolderItem) {
    if (!editName.trim()) return;
    onSaveFolder({
      ...folder,
      name: editName.trim(),
    });
    setEditingId(null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#1C1B22]/40 backdrop-blur-xs flex items-center justify-center p-4 text-[#1C1B22] select-none">
      <div className="bg-white border border-[#E6E6EB] rounded-xl w-full max-w-md flex flex-col shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6E6EB] bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1C1B22]">Manage Folders</h2>
              <p className="text-[11px] text-[#666672]">Organize your scanned documents</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F5F3FF] text-[#666672] hover:text-[#1C1B22] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleCreateFolder} className="p-5 border-b border-[#E6E6EB] space-y-3 bg-[#FAFAFC]">
          <label className="block text-[11px] font-semibold text-[#666672] uppercase tracking-wider">
            Create New Folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g., Medical Records, Invoices 2026..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="flex-1 bg-white border border-[#E6E6EB] rounded-lg px-3 py-2 text-xs text-[#1C1B22] placeholder-[#8E8E9A] focus:outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#F5F3FF]"
            />
            <button
              type="submit"
              disabled={!newFolderName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white font-semibold text-xs transition-colors shrink-0"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-[#666672] font-medium">Color Tag:</span>
            <div className="flex items-center gap-1.5">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  style={{ backgroundColor: color }}
                  className={`w-5 h-5 rounded-full transition-transform ${
                    selectedColor === color ? 'scale-125 ring-2 ring-[#7C3AED]' : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>
        </form>

        <div className="p-5 overflow-y-auto max-h-72 space-y-2 bg-white">
          <div className="text-[11px] font-semibold text-[#666672] uppercase tracking-wider mb-2">
            Existing Folders ({folders.length})
          </div>

          {folders.map((folder) => {
            const isEditing = editingId === folder.id;
            return (
              <div
                key={folder.id}
                className="flex items-center justify-between p-3 rounded-lg bg-[#FAFAFC] border border-[#E6E6EB]"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0 mr-2">
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ backgroundColor: folder.color }}
                  />
                  {isEditing ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 bg-white border border-[#7C3AED] rounded px-2 py-1 text-xs text-[#1C1B22] focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="text-xs font-semibold text-[#1C1B22] truncate">{folder.name}</span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isEditing ? (
                    <button
                      onClick={() => handleSaveEdit(folder)}
                      className="w-7 h-7 rounded-md bg-[#F5F3FF] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white flex items-center justify-center transition-colors"
                      title="Save name"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStartEdit(folder)}
                      className="w-7 h-7 rounded-md hover:bg-[#F5F3FF] text-[#666672] hover:text-[#7C3AED] flex items-center justify-center transition-colors"
                      title="Rename folder"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {!folder.isSystem && (
                    confirmDeleteId === folder.id ? (
                      <div className="flex items-center gap-1 ml-1">
                        <button
                          onClick={() => {
                            onDeleteFolder(folder.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-2 py-1 rounded-md bg-[#DC2626] hover:bg-red-700 text-white text-[11px] font-semibold transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 rounded-md bg-white border border-[#E6E6EB] text-[#666672] hover:text-[#1C1B22] text-[11px] font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(folder.id)}
                        className="w-7 h-7 rounded-md hover:bg-red-50 text-[#8E8E9A] hover:text-[#DC2626] flex items-center justify-center transition-colors"
                        title="Delete folder"
                        aria-label={`Delete folder ${folder.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
