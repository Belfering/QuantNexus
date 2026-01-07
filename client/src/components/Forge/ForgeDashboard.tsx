import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useEffect } from 'react';
import {
  useForgeConfig,
  useForgeEstimate,
  useForgeJob,
  useForgeStream,
  useProgressMetrics,
} from '@/hooks';
import { FlowchartStrategyEditor } from './FlowchartStrategyEditor';

export default function ForgeDashboard() {
  const { config, updateConfig, isValid } = useForgeConfig();
  const { estimate } = useForgeEstimate(config);
  const { jobId, running, startTime, startJob, cancelJob, completeJob } = useForgeJob();
  const { status, debugLog } = useForgeStream(jobId);
  const progress = useProgressMetrics(status, startTime);

  // Mark job as complete when status shows completed/failed/cancelled
  useEffect(() => {
    if (status && running && (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled')) {
      completeJob();
    }
  }, [status, running, completeJob]);

  const handleStart = async () => {
    try {
      await startJob(config);
    } catch (error) {
      console.error('Failed to start job:', error);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelJob();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Forge Dashboard</h2>
      </div>

      {/* Flowchart Strategy Editor (only mode) */}
      <FlowchartStrategyEditor config={config} updateConfig={updateConfig} />

      {/* Progress and Controls */}
      <Card className="p-6">
        {/* Estimate */}
        {estimate && !running && (
          <div className="mb-4 p-3 bg-secondary rounded">
            <p className="font-semibold">
              Estimate: {estimate.totalBranches.toLocaleString()} branches ≈{' '}
              {estimate.estimatedMinutes} min
            </p>
          </div>
        )}

        {/* Progress Bar */}
        {status && running && (
          <div className="mb-4 space-y-2">
            <div className="flex justify-between text-sm mb-1">
              <span className="font-semibold">Progress: {progress.progress}%</span>
              <span className="text-muted-foreground">
                {status.completedBranches.toLocaleString()} /{' '}
                {status.totalBranches.toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all"
                style={{ width: `${progress.progress}%` }}
              ></div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-sm mt-3">
              <div className="p-2 bg-green-50 rounded">
                <p className="text-xs text-muted-foreground">Passing</p>
                <p className="font-bold text-green-700">
                  {status.passingBranches.toLocaleString()}
                </p>
              </div>
              <div className="p-2 bg-blue-50 rounded">
                <p className="text-xs text-muted-foreground">Speed</p>
                <p className="font-bold text-blue-700">{progress.speed} br/sec</p>
              </div>
              <div className="p-2 bg-gray-50 rounded">
                <p className="text-xs text-muted-foreground">Elapsed</p>
                <p className="font-bold">
                  {Math.floor(progress.elapsed / 60)}:
                  {(progress.elapsed % 60).toString().padStart(2, '0')}
                </p>
              </div>
              <div className="p-2 bg-purple-50 rounded">
                <p className="text-xs text-muted-foreground">ETA</p>
                <p className="font-bold text-purple-700">
                  {Math.floor(progress.eta / 60)}:
                  {(progress.eta % 60).toString().padStart(2, '0')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex gap-3">
          {!running ? (
            <Button
              onClick={handleStart}
              className="flex-1 h-12 text-lg font-semibold"
              disabled={!isValid}
            >
              Start Forge
            </Button>
          ) : (
            <>
              <Button
                disabled
                className="flex-1 h-12 text-lg opacity-50 cursor-not-allowed"
              >
                Running...
              </Button>
              <Button
                onClick={handleCancel}
                variant="destructive"
                className="h-12 px-8 text-lg font-semibold"
              >
                Stop Run
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Debug Log */}
      {debugLog.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Debug Log (Last {debugLog.length} entries)</h3>
          <div className="bg-black text-green-400 font-mono text-xs p-3 rounded h-64 overflow-y-auto">
            {debugLog.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
