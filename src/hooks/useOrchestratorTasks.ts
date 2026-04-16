import { useEffect, useMemo, useState } from 'react'
import type { PipelineEvent, PipelineOrchestrator, TaskState } from '@/lib/pipeline/pipeline-orchestrator'

interface OrchestratorTasksState {
  tasks: TaskState[]
  activeTasks: TaskState[]
  pipelineRunning: boolean
  lastError: string | undefined
}

export function useOrchestratorTasks(orchestrator: PipelineOrchestrator | null): OrchestratorTasksState {
  const [tasks, setTasks] = useState<TaskState[]>([])
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [lastError, setLastError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!orchestrator) {
      setTasks([])
      setPipelineRunning(false)
      setLastError(undefined)
      return
    }

    setTasks(orchestrator.getTasks())

    return orchestrator.subscribe((event: PipelineEvent) => {
      if (event.type === 'task-update') {
        setTasks(orchestrator.getTasks())
        return
      }
      if (event.type === 'pipeline-start') {
        setPipelineRunning(true)
        setLastError(undefined)
        return
      }
      if (event.type === 'pipeline-done' || event.type === 'pipeline-cancelled') {
        setPipelineRunning(false)
        return
      }
      if (event.type === 'pipeline-failed') {
        setPipelineRunning(false)
        setLastError(event.error)
      }
    })
  }, [orchestrator])

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === 'running' || task.status === 'pending'),
    [tasks],
  )

  return { tasks, activeTasks, pipelineRunning, lastError }
}
