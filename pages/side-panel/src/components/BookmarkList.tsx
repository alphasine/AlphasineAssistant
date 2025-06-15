/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes } from 'react-icons/fa';

interface Bookmark {
  id: number;
  title: string;
  content: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  onBookmarkUpdate?: (id: number, title: string, content: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  onBookmarkAdd?: () => void;
  isDarkMode?: boolean;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onBookmarkUpdate,
  onBookmarkDelete,
  onBookmarkReorder,
  onBookmarkAdd,
  isDarkMode = false,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editContent, setEditContent] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
    setEditContent(bookmark.content);
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdate && editTitle.trim()) {
      onBookmarkUpdate(id, editTitle, editContent);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    // Add more transparent effect
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  // Focus the input field when entering edit mode
  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  return (
    <div className="p-2">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>Quick Start</h3>
        {onBookmarkAdd && (
          <button
            onClick={onBookmarkAdd}
            className={`rounded px-2 py-1 text-sm font-medium ${
              isDarkMode ? 'bg-sky-700 text-sky-200 hover:bg-sky-600' : 'bg-sky-100 text-sky-600 hover:bg-sky-200'
            }`}
            aria-label="Add new quick start prompt"
            type="button">
            Add New
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {bookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className={`group relative rounded-lg p-3 ${
              isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-sky-50'
            } border ${isDarkMode ? 'border-slate-700' : 'border-sky-100'}`}>
            {editingId === bookmark.id ? (
              <div className="flex items-center">
                <div className="grow">
                  <input
                    ref={inputRef}
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className={`mb-2 w-full rounded px-2 py-1 text-sm ${
                      isDarkMode
                        ? 'border-slate-600 bg-slate-700 text-gray-200'
                        : 'border-sky-100 bg-white text-gray-700'
                    } border`}
                    aria-label="Edit bookmark title"
                  />
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className={`w-full rounded px-2 py-1 text-sm ${
                      isDarkMode
                        ? 'border-slate-600 bg-slate-700 text-gray-200'
                        : 'border-sky-100 bg-white text-gray-700'
                    } border`}
                    rows={4}
                    aria-label="Edit bookmark content"
                  />
                </div>
                <div className="ml-2 flex flex-col">
                  <button
                    onClick={() => handleSaveEdit(bookmark.id)}
                    className={`mb-1 rounded p-1 ${
                      isDarkMode
                        ? 'bg-slate-700 text-green-400 hover:bg-slate-600'
                        : 'bg-white text-green-500 hover:bg-gray-100'
                    }`}
                    aria-label="Save edit"
                    type="button">
                    <FaCheck size={14} />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className={`rounded p-1 ${
                      isDarkMode
                        ? 'bg-slate-700 text-red-400 hover:bg-slate-600'
                        : 'bg-white text-red-500 hover:bg-gray-100'
                    }`}
                    aria-label="Cancel edit"
                    type="button">
                    <FaTimes size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => onBookmarkSelect(bookmark.content)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onBookmarkSelect(bookmark.content);
                      }
                    }}
                    className="w-full text-left">
                    <div
                      className={`truncate pr-10 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {bookmark.title}
                    </div>
                  </button>
                </div>
              </>
            )}

            {editingId !== bookmark.id && (
              <>
                {/* Edit button - top right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className={`absolute right-[28px] top-1/2 z-10 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-sky-400 hover:bg-slate-600'
                      : 'bg-white text-sky-500 hover:bg-gray-100'
                  }`}
                  aria-label="Edit bookmark"
                  type="button">
                  <FaPen size={14} />
                </button>

                {/* Delete button - bottom right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (onBookmarkDelete) {
                      onBookmarkDelete(bookmark.id);
                    }
                  }}
                  className={`absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                      : 'bg-white text-gray-500 hover:bg-gray-100'
                  }`}
                  aria-label="Delete bookmark"
                  type="button">
                  <FaTrash size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
