import type { TestResult } from './types';

export function TestResultDisplay({ result }: { result: TestResult }) {
    if (result === null) {
        return null;
    }
    return (
        <div className={`status-line ${result.tone}`} role="status">
            {result.message}
        </div>
    );
}
