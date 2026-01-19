// server/lib/jobs.mjs
// Shared job tracking for background tasks (downloads, syncs, etc.)

/**
 * In-memory storage for running/completed jobs
 * Jobs are cleaned up after 1 hour
 */
const jobs = new Map()

const JOB_CLEANUP_INTERVAL = 60 * 60 * 1000 // 1 hour
const JOB_MAX_AGE = 60 * 60 * 1000 // 1 hour

/**
 * Generate a unique job ID
 */
export function newJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a job by ID
 */
export function getJob(jobId) {
  return jobs.get(String(jobId || ''))
}

/**
 * Create a new job
 */
export function createJob(id, data) {
  const job = {
    id,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    events: [],
    logs: [],
    ...data
  }
  jobs.set(id, job)
  return job
}

/**
 * Update a job
 */
export function updateJob(jobId, updates) {
  const job = jobs.get(jobId)
  if (job) {
    Object.assign(job, updates)
  }
  return job
}

/**
 * Add a log line to a job
 */
export function addJobLog(jobId, line) {
  const job = jobs.get(jobId)
  if (!job) return

  const s = String(line || '').trimEnd()
  if (!s) return

  job.logs.push(s)
  if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)

  // Try to parse as JSON event
  try {
    const ev = JSON.parse(s)
    if (ev && typeof ev === 'object') {
      job.events.push(ev)
      if (job.events.length > 400) job.events.splice(0, job.events.length - 400)
    }
  } catch {
    // ignore non-JSON lines
  }
}

/**
 * Mark a job as complete
 */
export function completeJob(jobId, error = null) {
  const job = jobs.get(jobId)
  if (job) {
    job.finishedAt = Date.now()
    job.status = error ? 'error' : 'done'
    if (error) job.error = String(error)
  }
  return job
}

/**
 * Kill a running job by its PID
 */
export function killJob(jobId) {
  const job = jobs.get(jobId)
  if (!job) {
    return { success: false, error: 'Job not found' }
  }

  if (job.status !== 'running') {
    return { success: false, error: 'Job is not running' }
  }

  if (!job.pid) {
    return { success: false, error: 'No PID available for this job' }
  }

  try {
    process.kill(job.pid, 'SIGTERM')
    completeJob(jobId, 'Cancelled by user')
    return { success: true, message: 'Job cancelled' }
  } catch (err) {
    return { success: false, error: String(err.message || err) }
  }
}

/**
 * Get all jobs (for admin/debug)
 */
export function getAllJobs() {
  return Array.from(jobs.values())
}

/**
 * Cleanup old jobs periodically
 */
function cleanupOldJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_MAX_AGE) {
      jobs.delete(id)
    }
  }
}

// Start cleanup interval
setInterval(cleanupOldJobs, JOB_CLEANUP_INTERVAL)

export { jobs }
