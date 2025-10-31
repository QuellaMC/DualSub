import React from 'react';

export function TestResultDisplay({ result }) {
    if (!result.visible) {
        return null;
    }

    return <div className={`test-result ${result.type}`}>{result.message}</div>;
}
