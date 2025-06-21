import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone, FaTimes } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

export interface ChatInputPayload {
  text: string;
  image?: string; // base64 data URL
}

interface ChatInputProps {
  onSendMessage: (payload: ChatInputPayload) => void;
  onStopTask: () => void;
  onPauseResumeTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  isPaused: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onPauseResumeTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  isPaused,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && !pastedImage),
    [disabled, text, pastedImage],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle text changes and resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    // Resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = event => {
            setPastedImage(event.target?.result as string);
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  // Initial resize when component mounts
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (text.trim() || pastedImage) {
        onSendMessage({ text, image: pastedImage || undefined });
        setText('');
        setPastedImage(null);
      }
    },
    [text, pastedImage, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [handleSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-lg border transition-colors ${disabled ? 'cursor-not-allowed' : 'focus-within:border-sky-400 hover:border-sky-400'} ${isDarkMode ? 'border-slate-700' : ''}`}
      aria-label="Chat input form">
      <div className="flex flex-col">
        {pastedImage && (
          <div className="relative self-start p-2">
            <img src={pastedImage} alt="Pasted content" className="h-20 w-auto rounded-md" />
            <button
              type="button"
              onClick={() => setPastedImage(null)}
              className="absolute -right-1 -top-1 rounded-full bg-gray-700 p-1 text-white opacity-75 hover:opacity-100"
              aria-label="Remove image">
              <FaTimes className="size-3" />
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          aria-disabled={disabled}
          rows={1}
          className={`w-full resize-none border-none p-2 focus:outline-none ${
            disabled
              ? isDarkMode
                ? 'cursor-not-allowed bg-slate-800 text-gray-400'
                : 'cursor-not-allowed bg-gray-100 text-gray-500'
              : isDarkMode
                ? 'bg-slate-800 text-gray-200'
                : 'bg-white'
          }`}
          placeholder="What can I help you with? You can also paste images."
          aria-label="Message input"
        />

        <div
          className={`flex items-center justify-between px-2 py-1.5 ${
            disabled ? (isDarkMode ? 'bg-slate-800' : 'bg-gray-100') : isDarkMode ? 'bg-slate-800' : 'bg-white'
          }`}>
          <div className="flex gap-2 text-gray-500">
            {onMicClick && (
              <button
                type="button"
                onClick={onMicClick}
                disabled={disabled || isProcessingSpeech}
                aria-label={
                  isProcessingSpeech ? 'Processing speech...' : isRecording ? 'Stop recording' : 'Start voice input'
                }
                className={`rounded-md p-1.5 transition-colors ${
                  disabled || isProcessingSpeech
                    ? 'cursor-not-allowed opacity-50'
                    : isRecording
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : isDarkMode
                        ? 'hover:bg-slate-700 text-gray-400 hover:text-gray-200'
                        : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
                }`}>
                {isProcessingSpeech ? (
                  <AiOutlineLoading3Quarters className="h-4 w-4 animate-spin" />
                ) : (
                  <FaMicrophone className={`h-4 w-4 ${isRecording ? 'animate-pulse' : ''}`} />
                )}
              </button>
            )}
          </div>

          {showStopButton ? (
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={onPauseResumeTask}
                className={`rounded-md px-3 py-1 text-white transition-colors ${
                  isPaused ? 'bg-green-500 hover:bg-green-600' : 'bg-yellow-500 hover:bg-yellow-600'
                }`}>
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={onStopTask}
                className="rounded-md bg-red-500 px-3 py-1 text-white transition-colors hover:bg-red-600">
                Stop
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`rounded-md bg-[#19C2FF] px-3 py-1 text-white transition-colors hover:enabled:bg-[#0073DC] ${isSendButtonDisabled ? 'cursor-not-allowed opacity-50' : ''}`}>
              Send
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
