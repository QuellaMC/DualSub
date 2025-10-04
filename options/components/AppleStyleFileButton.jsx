import React from 'react';

/**
 * Apple-style file upload button component
 * Mimics the design of macOS file selection buttons
 */
export function AppleStyleFileButton({ 
    onClick, 
    disabled, 
    children, 
    className = '',
    loading = false 
}) {
    return (
        <button
            type="button"
            className={`apple-file-btn ${className} ${loading ? 'loading' : ''}`}
            onClick={onClick}
            disabled={disabled || loading}
        >
            {loading ? (
                <div className="apple-spinner">
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                </div>
            ) : (
                <svg 
                    className="apple-icon" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path 
                        d="M9 17V11L7 13M9 11L11 13" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                    />
                    <path 
                        d="M13 7H16.5C18.433 7 20 8.567 20 10.5C20 12.433 18.433 14 16.5 14H13" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round"
                    />
                    <path 
                        d="M4 16.5V7C4 5.89543 4.89543 5 6 5H13V9.5C13 10.3284 13.6716 11 14.5 11H18V16.5C18 17.6046 17.1046 18.5 16 18.5H6C4.89543 18.5 4 17.6046 4 16.5Z" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                    />
                </svg>
            )}
            <span className="apple-btn-text">{children}</span>
        </button>
    );
}

