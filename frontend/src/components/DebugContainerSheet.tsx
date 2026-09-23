import { useState } from 'react'
import { Bug, Loader2 } from 'lucide-react'
import { debugPodContainer, errorMessage } from '../api/client'
import type { Cluster, DebugContainerResult, Pod } from '../api/types'
import { Button, Notice, Select, Sheet } from './primitives'

/*
 * The pod that has no shell.
 *
 * `exec` needs a shell in the target container to attach a terminal to, and a
 * distroless or scratch image has none — which is exactly the kind of image
 * worth running in production and therefore exactly the pod an operator most
 * needs to get into. This is `kubectl debug`'s trick: a second, throwaway
 * container written onto the running pod, sharing the chosen container's
 * process namespace, that the console execs into instead.
 *
 * It is a write like any other here — impersonated, answered by the cluster's
 * own RBAC, audited — but it is not a small one, and both things that make it
 * so are stated before the button rather than found out afterwards: the
 * container cannot be removed once it exists, and it shares the target's
 * namespaces for as long as the pod lives.
 */

const DEBUG_BLURB =
  'This adds a second, throwaway container to the pod, sharing the chosen container’s process ' +
  'namespace so a shell can attach where the application image has none of its own. It goes down ' +
  'the same impersonated tunnel as every other write here — the cluster’s own RBAC decides ' +
  'whether it lands.'

/** The two things this cannot undo. Said before the click, not in the result. */
const DEBUG_LIMITS =
  'The container cannot be removed once it is added — the API server has no delete for an ' +
  'ephemeral container — and it shares the target container’s process namespace, and from there ' +
  'its network, for as long as the pod lives.'

export function DebugContainerSheet({
  cluster,
  pod,
  onClose,
  onStarted,
}: {
  cluster: Cluster
  pod: Pod
  onClose: () => void
  /** Called once the container is written and the exec half can begin — the
      caller retargets its terminal at `result.container`, never at the pod's
      own container the debug session was asked against. */
  onStarted: (result: DebugContainerResult) => void
}) {
  const [target, setTarget] = useState(pod.containers[0]?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    if (busy || !target) return
    setBusy(true)
    setError(null)
    try {
      const result = await debugPodContainer(cluster.id, pod.name, pod.namespace, target)
      onStarted(result)
    } catch (err) {
      setError(errorMessage(err, `A debug container could not be added to ${pod.name}.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      eyebrow={`${pod.namespace} / ${pod.name}`}
      title="Start a debug session"
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} disabled={busy || !target}>
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Bug aria-hidden="true" className="size-4" />
            )}
            Start debug session
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className="text-[13px] leading-relaxed text-muted">{DEBUG_BLURB}</p>
        <Notice tone="warn">{DEBUG_LIMITS}</Notice>
        {pod.containers.length > 1 ? (
          <label className="flex flex-col gap-1.5 text-[12px] text-muted">
            Share the process namespace of
            <Select
              aria-label="Container to debug"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {pod.containers.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
    </Sheet>
  )
}
