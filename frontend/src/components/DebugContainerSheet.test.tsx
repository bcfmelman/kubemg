/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Cluster, DebugContainerResult, Pod } from '../api/types'
import { DebugContainerSheet } from './DebugContainerSheet'

/*
 * What is asserted here is the discipline the issue asked for: both facts an
 * operator cannot undo — no delete, shared namespaces — are on screen before
 * the button is reachable, the write addresses the container chosen from the
 * pod's own list, and the caller is handed the *new* container's name rather
 * than the one the session was asked against.
 */

const calls: unknown[][] = []
let answer: () => Promise<DebugContainerResult> = async () => result()

vi.mock('../api/client', () => ({
  debugPodContainer: (...args: unknown[]) => {
    calls.push(args)
    return answer()
  },
  errorMessage: (_err: unknown, fallback: string) => fallback,
}))

const cluster = { id: 7, name: 'prod' } as Cluster

const pod: Pod = {
  name: 'checkout-7f9',
  namespace: 'shop',
  phase: 'Running',
  node: 'node-1',
  ready: 1,
  total: 1,
  restarts: 0,
  created_at: '2026-01-01T00:00:00Z',
  containers: [container('app', 'gcr.io/shop/checkout:1.0'), container('sidecar', 'envoy:1.30')],
}

function container(name: string, image: string): Pod['containers'][number] {
  return {
    name,
    image,
    ready: true,
    restarts: 0,
    state: 'running',
    cpu_request_millicores: 0,
    cpu_limit_millicores: 0,
    memory_request_bytes: 0,
    memory_limit_bytes: 0,
  }
}

function result(over: Partial<DebugContainerResult> = {}): DebugContainerResult {
  return {
    pod: 'checkout-7f9',
    namespace: 'shop',
    container: 'debug-abcd1234',
    target_container: 'app',
    image: 'busybox:1.36',
    message: 'debug-abcd1234 is starting on checkout-7f9 — connecting once it is running',
    ...over,
  }
}

beforeEach(() => {
  calls.length = 0
  answer = async () => result()
})
afterEach(cleanup)

describe('DebugContainerSheet', () => {
  it('states both irreversible facts before the button is usable', () => {
    render(<DebugContainerSheet cluster={cluster} pod={pod} onClose={() => {}} onStarted={() => {}} />)

    expect(screen.getByText(/cannot be removed/)).toBeTruthy()
    expect(screen.getByText(/shares the target container.s process namespace/)).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('offers a container picker when the pod has more than one, defaulting to the first', () => {
    render(<DebugContainerSheet cluster={cluster} pod={pod} onClose={() => {}} onStarted={() => {}} />)

    const picker = screen.getByRole('combobox', { name: 'Container to debug' }) as HTMLSelectElement
    expect(picker.value).toBe('app')
  })

  it('writes against the chosen container and hands the new one back', async () => {
    const started = vi.fn()
    render(<DebugContainerSheet cluster={cluster} pod={pod} onClose={() => {}} onStarted={started} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Container to debug' }), {
      target: { value: 'sidecar' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Start debug session/ }))
    })

    await waitFor(() => expect(started).toHaveBeenCalledTimes(1))
    expect(calls).toEqual([[7, 'checkout-7f9', 'shop', 'sidecar']])
    // The exec half is told to address the container that was created, never
    // the one the debug session shared a namespace with.
    expect(started.mock.calls[0][0].container).toBe('debug-abcd1234')
  })

  it("hands back the server's refusal rather than closing", async () => {
    answer = async () => {
      throw new Error('nope')
    }
    const started = vi.fn()
    render(<DebugContainerSheet cluster={cluster} pod={pod} onClose={() => {}} onStarted={started} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Start debug session/ }))
    })

    await waitFor(() =>
      expect(screen.getByText('A debug container could not be added to checkout-7f9.')).toBeTruthy(),
    )
    expect(started).not.toHaveBeenCalled()
  })

  it('skips the picker for a single-container pod and targets it directly', async () => {
    const single: Pod = { ...pod, containers: [pod.containers[0]] }
    const started = vi.fn()
    render(<DebugContainerSheet cluster={cluster} pod={single} onClose={() => {}} onStarted={started} />)

    expect(screen.queryByRole('combobox', { name: 'Container to debug' })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Start debug session/ }))
    })

    await waitFor(() => expect(started).toHaveBeenCalledTimes(1))
    expect(calls).toEqual([[7, 'checkout-7f9', 'shop', 'app']])
  })
})
