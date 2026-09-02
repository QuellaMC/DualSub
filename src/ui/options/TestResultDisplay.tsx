import type { TestResult } from './types';

export function TestResultDisplay({ result }: { result: TestResult }) {
    if (result === null) {
        return null;
    }
    return (
        <div className={`test-result ${result.tone}`} role="status">
            {result.message}
        </div>
    );
}
