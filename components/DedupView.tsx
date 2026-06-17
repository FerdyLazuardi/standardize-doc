'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw, ChevronDown, ChevronUp, ChevronsDown, Trash2 } from 'lucide-react'
import { MdBulkUploader, type LoadedDoc } from './MdBulkUploader'
import { judgeDuplicatesBatched, rewriteDifferentiate } from '@/lib/api'
import type { JudgePairInput, JudgeVerdict } from '@/lib/api'
import {
  extractH1Sections,
  findCandidatePairs,
  replaceH1Section,
  deleteH1Section,
  validateSection,
  sharedSignificantTokens,
  firstH1Heading,
} from '@/lib/dedup'
import type { ValidationIssue } from '@/lib/validators'
import JSZip from 'jszip'

type Pair = JudgeVerdict & {
  a_text: string
  b_text: string
  a_doc: string
  b_doc: string
  a_idx: number
  b_idx: number
  // original list position for order-preserving undo
  originalOrder: number
}

type RewrittenPair = {
  pair: Pair
  action: 'rewrite' | 'delete'
  // rewrite
  section_a?: string
  section_b?: string
  issues_a?: ValidationIssue[]
  issues_b?: ValidationIssue[]
  // delete
  deleted_side?: 'a' | 'b'
  deleted_heading?: string
  kept_heading?: string
}

export default function DedupView() {
  const [docs, setDocs] = useState<LoadedDoc[]>([])
  const [pairs, setPairs] = useState<Pair[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState('')
  const [scanProgress, setScanProgress] = useState(0)
  const [scanned, setScanned] = useState(false)
  const [rewriting, setRewriting] = useState<Set<string>>(new Set())
  const [rewriteAllProgress, setRewriteAllProgress] = useState<{ done: number; total: number } | null>(null)
  const [previews, setPreviews] = useState<Map<string, RewrittenPair>>(new Map())
  // undo: pair_id -> { a_markdown, b_markdown, pair, originalOrder }
  const [undoStack, setUndoStack] = useState<Map<string, {
    a_markdown: string
    b_markdown: string
    pair: Pair
  }>>(new Map())

  const docsRef = useRef<LoadedDoc[]>([])
  const commitDocs = (next: LoadedDoc[]) => {
    docsRef.current = next
    setDocs(next)
  }

  const handleUpload = (uploaded: LoadedDoc[]) => {
    const merged = [...docsRef.current]
    for (const doc of uploaded) {
      const idx = merged.findIndex(d => d.name === doc.name)
      if (idx !== -1) merged[idx] = doc
      else merged.push(doc)
    }
    commitDocs(merged)
    setPairs([])
    setScanned(false)
    setPreviews(new Map())
    setUndoStack(new Map())
  }

  const handleScan = async () => {
    if (docs.length < 2) return
    setScanning(true)
    setScanProgress(0)
    setScanStatus('Extracting sections…')
    try {
      const allSections = docs.flatMap((doc, idx) =>
        extractH1Sections(doc.markdown, doc.name, idx)
      )
      setScanProgress(15)
      setScanStatus('Computing similarity…')

      const candidates = findCandidatePairs(allSections)
      setScanProgress(30)

      if (candidates.length === 0) {
        setPairs([])
        setScanned(true)
        return
      }

      const totalBatches = Math.ceil(candidates.length / 8)
      setScanStatus(`Judging ${candidates.length} candidate pair${candidates.length !== 1 ? 's' : ''} (${totalBatches} batch${totalBatches !== 1 ? 'es' : ''})…`)
      setScanProgress(35)

      const judgeInput: JudgePairInput[] = candidates.map(c => ({
        pair_id: c.pair_id,
        a_doc: c.a.doc_name,
        a_heading: c.a.heading,
        a_text: c.a.text,
        b_doc: c.b.doc_name,
        b_heading: c.b.heading,
        b_text: c.b.text,
        cosine: c.similarity
      }))

      const result = await judgeDuplicatesBatched(judgeInput, {
        batchSize: 8,
        onBatch: (done, total) => {
          const pct = 35 + Math.round((done / total) * 55)
          setScanProgress(pct)
          setScanStatus(`Judging batch ${done}/${total}…`)
        }
      })

      if (result.failedBatches > 0) {
        toast.error(`${result.failedBatches} batch${result.failedBatches !== 1 ? 'es' : ''} failed — results may be incomplete.`)
      }

      setScanProgress(92)
      setScanStatus('Processing results…')

      const byId = new Map(candidates.map(c => [c.pair_id, c]))
      const enriched: Pair[] = []
      let order = 0
      for (const v of result.verdicts) {
        if (v.verdict !== 'duplicate' && v.verdict !== 'overlap') continue
        const candidate = byId.get(v.pair_id)
        if (!candidate) continue
        enriched.push({
          ...v,
          a_text: candidate.a.text,
          b_text: candidate.b.text,
          a_doc: candidate.a.doc_name,
          b_doc: candidate.b.doc_name,
          a_idx: candidate.a.doc_index,
          b_idx: candidate.b.doc_index,
          originalOrder: order++,
        })
      }

      setScanProgress(100)
      setPairs(enriched)
      setScanned(true)
    } catch (err) {
      toast.error('Scan failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setScanning(false)
      setScanStatus('')
      setScanProgress(0)
    }
  }

  // Stale-pair guard: check if the section text still exists in the current doc
  const isSectionStale = (pair: Pair): { aStale: boolean; bStale: boolean } => {
    const current = docsRef.current
    const aStale = !current[pair.a_idx]?.markdown.includes(pair.a_text.trim())
    const bStale = !current[pair.b_idx]?.markdown.includes(pair.b_text.trim())
    return { aStale, bStale }
  }

  const doDelete = async (pair: Pair, deleteSide: 'a' | 'b'): Promise<boolean> => {
    const key = pair.pair_id
    const { aStale, bStale } = isSectionStale(pair)
    const isStale = deleteSide === 'a' ? aStale : bStale
    if (isStale) {
      toast.error('Section was already modified by a previous action — pair skipped.')
      setPairs(prev => prev.filter(p => p.pair_id !== key))
      return false
    }

    setRewriting(prev => new Set(prev).add(key))
    try {
      const current = docsRef.current
      const idx = deleteSide === 'a' ? pair.a_idx : pair.b_idx
      const sectionText = deleteSide === 'a' ? pair.a_text : pair.b_text
      const doc = current[idx]
      if (!doc) { toast.error('Document not found.'); return false }

      const res = deleteH1Section(doc.markdown, sectionText)
      if (!res.removed) {
        toast.error('Section could not be located — pair kept for review.')
        return false
      }

      const next = [...current]
      next[idx] = { ...doc, markdown: res.markdown }

      setUndoStack(prev => new Map(prev).set(key, {
        a_markdown: current[pair.a_idx]?.markdown ?? '',
        b_markdown: current[pair.b_idx]?.markdown ?? '',
        pair,
      }))
      commitDocs(next)

      const deletedHeading = firstH1Heading(sectionText)
      const keptText = deleteSide === 'a' ? pair.b_text : pair.a_text
      const keptHeading = firstH1Heading(keptText)

      setPreviews(prev => new Map(prev).set(key, {
        pair,
        action: 'delete',
        deleted_side: deleteSide,
        deleted_heading: deletedHeading,
        kept_heading: keptHeading,
      }))
      setPairs(prev => prev.filter(p => p.pair_id !== key))
      return true
    } catch (err) {
      toast.error('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
      return false
    } finally {
      setRewriting(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  const doRewrite = async (pair: Pair): Promise<boolean> => {
    const key = pair.pair_id
    const { aStale, bStale } = isSectionStale(pair)
    if (aStale || bStale) {
      toast.error('One or both sections were already modified — pair skipped.')
      setPairs(prev => prev.filter(p => p.pair_id !== key))
      return false
    }

    setRewriting(prev => new Set(prev).add(key))
    try {
      const result = await rewriteDifferentiate({
        a_text: pair.a_text,
        b_text: pair.b_text,
        shared_topic: pair.shared_topic,
        a_unique_angle: pair.a_unique_angle,
        b_unique_angle: pair.b_unique_angle,
        entity_name: 'Amartha',
      })

      const current = docsRef.current
      const docA = current[pair.a_idx]
      const docB = current[pair.b_idx]
      let spliceOk = true
      const next = [...current]

      if (docA) {
        const resA = replaceH1Section(docA.markdown, pair.a_text, result.section_a)
        if (!resA.replaced) spliceOk = false
        next[pair.a_idx] = { ...docA, markdown: resA.markdown }
      } else { spliceOk = false }

      if (docB) {
        const resB = replaceH1Section(next[pair.b_idx].markdown, pair.b_text, result.section_b)
        if (!resB.replaced) spliceOk = false
        next[pair.b_idx] = { ...next[pair.b_idx], markdown: resB.markdown }
      } else { spliceOk = false }

      if (!spliceOk) {
        toast.error('Rewrite skipped — sections could not be located. Pair kept for review.')
        return false
      }

      const issues_a = validateSection(result.section_a, 'Amartha')
      const issues_b = validateSection(result.section_b, 'Amartha')

      setUndoStack(prev => new Map(prev).set(key, {
        a_markdown: current[pair.a_idx]?.markdown ?? '',
        b_markdown: current[pair.b_idx]?.markdown ?? '',
        pair,
      }))
      commitDocs(next)
      setPreviews(prev => new Map(prev).set(key, {
        pair,
        action: 'rewrite',
        section_a: result.section_a,
        section_b: result.section_b,
        issues_a,
        issues_b,
      }))
      setPairs(prev => prev.filter(p => p.pair_id !== key))
      return true
    } catch (err) {
      toast.error('Rewrite failed: ' + (err instanceof Error ? err.message : String(err)))
      return false
    } finally {
      setRewriting(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  const handleRewriteAll = async () => {
    const todo = [...pairs]
    setRewriteAllProgress({ done: 0, total: todo.length })
    let done = 0
    for (const pair of todo) {
      // Always rewrite to differentiate — never auto-delete. A short side may be
      // a deliberate catalog entry (e.g. a Product Knowledge doc), not a stray
      // shallow mention, so dropping it would lose real content. Delete stays a
      // manual, per-pair action in PairCard.
      await doRewrite(pair)
      done++
      setRewriteAllProgress({ done, total: todo.length })
    }
    setRewriteAllProgress(null)
    toast.success(`Fix All complete — ${done}/${todo.length} pairs processed.`)
  }

  const handleUndo = (key: string) => {
    const snapshot = undoStack.get(key)
    const preview = previews.get(key)
    if (!snapshot || !preview) return
    const current = docsRef.current
    const next = [...current]
    next[preview.pair.a_idx] = { ...next[preview.pair.a_idx], markdown: snapshot.a_markdown }
    next[preview.pair.b_idx] = { ...next[preview.pair.b_idx], markdown: snapshot.b_markdown }
    commitDocs(next)
    // Restore pair at its original position
    setPairs(prev => {
      const without = prev.filter(p => p.pair_id !== key)
      const insertAt = without.findIndex(p => p.originalOrder > snapshot.pair.originalOrder)
      if (insertAt === -1) return [...without, snapshot.pair]
      const copy = [...without]
      copy.splice(insertAt, 0, snapshot.pair)
      return copy
    })
    setPreviews(prev => { const m = new Map(prev); m.delete(key); return m })
    setUndoStack(prev => { const m = new Map(prev); m.delete(key); return m })
    toast.success('Action undone.')
  }

  const handleDismissPreview = (key: string) => {
    setPreviews(prev => { const m = new Map(prev); m.delete(key); return m })
  }

  const handleDownloadAll = async () => {
    if (docs.length === 0) return
    const zip = new JSZip()
    docs.forEach(doc => zip.file(doc.name, doc.markdown))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'deduplicated-docs.zip'; a.click()
    URL.revokeObjectURL(url)
  }

  const duplicatePairs = pairs.filter(p => p.verdict === 'duplicate')
  const overlapPairs = pairs.filter(p => p.verdict === 'overlap')
  const previewList = Array.from(previews.values())

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">

      {/* Header + uploader */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-text">Cross-Document Duplicate Detection</h1>
        <MdBulkUploader onFiles={handleUpload} busy={scanning} count={docs.length} />

        {docs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                {docs.length} document{docs.length !== 1 ? 's' : ''} loaded
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleScan}
                  disabled={scanning || docs.length < 2 || !!rewriteAllProgress}
                  className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accentHover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {scanning ? 'Scanning…' : 'Scan for Duplicates'}
                </button>
                {pairs.length > 1 && !rewriteAllProgress && (
                  <button
                    onClick={handleRewriteAll}
                    disabled={scanning || rewriting.size > 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronsDown className="w-4 h-4" />
                    Fix All ({pairs.length})
                  </button>
                )}
                <button
                  onClick={handleDownloadAll}
                  disabled={scanning}
                  className="px-4 py-2 bg-success text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Download All
                </button>
              </div>
            </div>
            <div className="text-xs text-muted space-y-0.5">
              {docs.map(doc => (
                <div key={doc.name} className="font-mono truncate">{doc.name}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Scan progress */}
      {scanning && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-text">
            <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
            <span>{scanStatus || 'Scanning…'}</span>
            <span className="font-mono text-accent ml-auto">{scanProgress}%</span>
          </div>
          <div className="progress-track">
            {scanProgress > 0
              ? <div className="progress-fill" style={{ width: `${scanProgress}%` }} />
              : <div className="progress-indeterminate" />}
          </div>
        </div>
      )}

      {/* Fix All progress */}
      {rewriteAllProgress && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-text">
            <Loader2 className="w-4 h-4 text-purple-600 animate-spin shrink-0" />
            <span>Processing pair {rewriteAllProgress.done + 1} of {rewriteAllProgress.total}…</span>
            <span className="font-mono text-purple-600 ml-auto">
              {Math.round((rewriteAllProgress.done / rewriteAllProgress.total) * 100)}%
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round((rewriteAllProgress.done / rewriteAllProgress.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {scanned && pairs.length === 0 && previewList.length === 0 && !scanning && (
        <p className="text-sm text-success bg-successSoft border border-success/20 rounded-lg px-4 py-3">
          No duplicate or overlapping sections found across the uploaded documents.
        </p>
      )}

      {/* Before/after previews */}
      {previewList.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-text">
            Processed ({previewList.length}) — review before downloading
          </h2>
          {previewList.map((p) => (
            <ActionPreviewCard
              key={p.pair.pair_id}
              preview={p}
              onUndo={() => handleUndo(p.pair.pair_id)}
              onDismiss={() => handleDismissPreview(p.pair.pair_id)}
            />
          ))}
        </div>
      )}

      {/* Pending pairs */}
      {pairs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-text">
            Found {pairs.length} pair{pairs.length !== 1 ? 's' : ''} to review
          </h2>
          {duplicatePairs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-error">
                Duplicates ({duplicatePairs.length})
              </h3>
              {duplicatePairs.map(pair => (
                <PairCard key={pair.pair_id} pair={pair} onRewrite={doRewrite} onDelete={doDelete} rewriting={rewriting} />
              ))}
            </div>
          )}
          {overlapPairs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-warn">
                Overlaps ({overlapPairs.length})
              </h3>
              {overlapPairs.map(pair => (
                <PairCard key={pair.pair_id} pair={pair} onRewrite={doRewrite} onDelete={doDelete} rewriting={rewriting} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ActionPreviewCard ─────────────────────────────────────────────────────────

function ValidationWarnings({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter(i => i.severity === 'error')
  const warns = issues.filter(i => i.severity === 'warn')
  if (errors.length === 0 && warns.length === 0) return null
  return (
    <div className="space-y-1 mt-1">
      {errors.map((i, idx) => (
        <div key={idx} className="flex items-start gap-1.5 text-xs text-error bg-errorSoft border border-error/20 rounded px-2 py-1">
          <span className="font-semibold shrink-0">Error:</span>
          <span>{i.message}</span>
        </div>
      ))}
      {warns.map((i, idx) => (
        <div key={idx} className="flex items-start gap-1.5 text-xs text-warn bg-warnSoft border border-warn/20 rounded px-2 py-1">
          <span className="font-semibold shrink-0">Warn:</span>
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  )
}

function ActionPreviewCard({
  preview,
  onUndo,
  onDismiss,
}: {
  preview: RewrittenPair
  onUndo: () => void
  onDismiss: () => void
}) {
  const [expandA, setExpandA] = useState(false)
  const [expandB, setExpandB] = useState(false)
  const { pair, action } = preview

  const hasWarnings =
    (preview.issues_a && preview.issues_a.filter(i => i.severity !== 'info').length > 0) ||
    (preview.issues_b && preview.issues_b.filter(i => i.severity !== 'info').length > 0)

  return (
    <div className={`border rounded-lg p-4 space-y-3 bg-surface shadow-card ${hasWarnings ? 'border-warn/40' : 'border-success/30'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {action === 'delete' ? (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">deleted</span>
          ) : (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-successSoft text-success border border-success/20">rewritten</span>
          )}
          {hasWarnings && (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-warnSoft text-warn border border-warn/20">has warnings</span>
          )}
          <span className="text-sm font-medium text-text">{pair.shared_topic}</span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onUndo} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded hover:bg-surfaceAlt transition-colors text-textSecondary">
            <RotateCcw className="w-3.5 h-3.5" /> Undo
          </button>
          <button onClick={onDismiss} className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surfaceAlt transition-colors text-textSecondary">
            Dismiss
          </button>
        </div>
      </div>

      {action === 'delete' && (
        <div className="text-sm space-y-1">
          <div className="flex items-center gap-2 text-textSecondary">
            <Trash2 className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span>Deleted chunk <span className="font-mono text-text">{preview.deleted_heading}</span> from <span className="font-medium">{preview.deleted_side === 'a' ? pair.a_doc : pair.b_doc}</span></span>
          </div>
          <div className="flex items-center gap-2 text-textSecondary">
            <span className="w-3.5 h-3.5 shrink-0" />
            <span>Kept chunk <span className="font-mono text-text">{preview.kept_heading}</span> in <span className="font-medium">{preview.deleted_side === 'a' ? pair.b_doc : pair.a_doc}</span> as the authoritative source</span>
          </div>
        </div>
      )}

      {action === 'rewrite' && preview.section_a && preview.section_b && (
        <div className="space-y-3">
          {([
            { label: 'A', doc: pair.a_doc, before: pair.a_text, after: preview.section_a, issues: preview.issues_a ?? [], expand: expandA, setExpand: setExpandA, color: 'text-accent', dot: 'bg-accent' },
            { label: 'B', doc: pair.b_doc, before: pair.b_text, after: preview.section_b, issues: preview.issues_b ?? [], expand: expandB, setExpand: setExpandB, color: 'text-success', dot: 'bg-success' },
          ] as const).map(({ label, doc, before, after, issues, expand, setExpand, color, dot }) => {
            const beforeHeading = firstH1Heading(before)
            const afterHeading = firstH1Heading(after)
            const headingChanged = beforeHeading !== afterHeading
            return (
              <div key={label} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surfaceAlt border-b border-border">
                  <div className={`flex items-center gap-1.5 text-xs ${color} min-w-0`}>
                    <span className={`w-4 h-4 rounded-full ${dot} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>{label}</span>
                    <span className="font-medium text-textSecondary truncate">{doc}</span>
                  </div>
                  <button onClick={() => setExpand(!expand)} className={`text-xs ${color} flex items-center gap-0.5 hover:underline shrink-0`}>
                    {expand ? <><ChevronUp className="w-3 h-3" />Hide full text</> : <><ChevronDown className="w-3 h-3" />Show full text</>}
                  </button>
                </div>

                <div className="grid grid-cols-2 divide-x divide-border">
                  {/* BEFORE (left) */}
                  <div className="p-3 space-y-1.5 bg-surface">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Before</div>
                    <div className="font-mono text-xs text-textSecondary break-words"># {beforeHeading || '—'}</div>
                    {expand && (
                      <pre className="text-xs bg-surfaceAlt border border-border rounded p-2 whitespace-pre-wrap font-mono text-textSecondary max-h-64 overflow-y-auto">{before}</pre>
                    )}
                  </div>
                  {/* AFTER (right) */}
                  <div className="p-3 space-y-1.5 bg-successSoft">
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      After
                      {headingChanged && <span className="px-1 py-0.5 rounded bg-success/15 text-success text-[9px] normal-case tracking-normal">heading changed</span>}
                    </div>
                    <div className={`font-mono text-xs break-words ${headingChanged ? 'text-success font-semibold' : 'text-textSecondary'}`}># {afterHeading || '—'}</div>
                    {expand && (
                      <pre className="text-xs bg-surface border border-border rounded p-2 whitespace-pre-wrap font-mono text-textSecondary max-h-64 overflow-y-auto">{after}</pre>
                    )}
                  </div>
                </div>

                {issues.length > 0 && (
                  <div className="px-3 pb-2">
                    <ValidationWarnings issues={issues} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── HighlightedText ───────────────────────────────────────────────────────────

function HighlightedText({ text, shared }: { text: string; shared: Set<string> }) {
  if (shared.size === 0) return <span>{text}</span>
  const TOKEN_RE = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu
  const parts: { word: string; highlight: boolean }[] = []
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const word = m[0]
    parts.push({ word, highlight: shared.has(word.toLowerCase()) })
  }
  return (
    <span>
      {parts.map((p, i) =>
        p.highlight
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{p.word}</mark>
          : <span key={i}>{p.word}</span>
      )}
    </span>
  )
}

// ── PairCard ──────────────────────────────────────────────────────────────────

function PairCard({
  pair,
  onRewrite,
  onDelete,
  rewriting,
}: {
  pair: Pair
  onRewrite: (pair: Pair) => void
  onDelete: (pair: Pair, side: 'a' | 'b') => void
  rewriting: Set<string>
}) {
  const [expandA, setExpandA] = useState(false)
  const [expandB, setExpandB] = useState(false)
  const isRewriting = rewriting.has(pair.pair_id)
  const shared = sharedSignificantTokens(pair.a_text, pair.b_text)

  const simColor =
    pair.similarity >= 0.8 ? 'bg-errorSoft text-error' :
    pair.similarity >= 0.6 ? 'bg-warnSoft text-warn' :
    'bg-accentSoft text-accent'

  const verdictBadge =
    pair.verdict === 'duplicate'
      ? 'bg-errorSoft text-error border border-error/20'
      : 'bg-warnSoft text-warn border border-warn/20'

  // A clear dominant side means the other is a shallow mention — surfaced as a
  // manual Delete option, but never the default action. Rewrite is always
  // primary so a deliberately-short side (e.g. a catalog entry) isn't dropped.
  const canDelete = pair.dominant === 'a' || pair.dominant === 'b'

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${verdictBadge}`}>{pair.verdict}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${simColor}`}>{(pair.similarity * 100).toFixed(0)}% similar</span>
            <span className="text-sm font-medium text-text truncate">{pair.shared_topic}</span>
          </div>
          <div className="text-xs text-muted space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-accentSoft text-accent text-[10px] font-bold flex items-center justify-center shrink-0">A</span>
              <span className="font-medium text-textSecondary truncate">{pair.a_doc}</span>
              <span className="text-muted">›</span>
              <span className="font-mono truncate text-text">{firstH1Heading(pair.a_text)}</span>
              {pair.dominant === 'a' && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 border border-orange-200 shrink-0">shallow</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-successSoft text-success text-[10px] font-bold flex items-center justify-center shrink-0">B</span>
              <span className="font-medium text-textSecondary truncate">{pair.b_doc}</span>
              <span className="text-muted">›</span>
              <span className="font-mono truncate text-text">{firstH1Heading(pair.b_text)}</span>
              {pair.dominant === 'b' && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 border border-orange-200 shrink-0">shallow</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={() => onRewrite(pair)}
            disabled={isRewriting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
          >
            {isRewriting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Rewriting…</> : 'Rewrite to Differentiate'}
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete(pair, pair.dominant as 'a' | 'b')}
              disabled={isRewriting}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-orange-300 text-orange-700 text-xs rounded hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {`Delete ${pair.dominant === 'a' ? 'A' : 'B'} (shallow)`}
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-textSecondary bg-surfaceAlt px-3 py-2 rounded">
        <span className="font-medium text-text">Reason: </span>{pair.reason}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-accentSoft border border-accent/15 p-3 rounded">
          <div className="flex items-center gap-1 font-medium text-accent mb-1 text-xs uppercase tracking-wide">
            <span className="w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">A</span>
            Unique angle
          </div>
          <div className="text-textSecondary text-xs">{pair.a_unique_angle}</div>
        </div>
        <div className="bg-successSoft border border-success/15 p-3 rounded">
          <div className="flex items-center gap-1 font-medium text-success mb-1 text-xs uppercase tracking-wide">
            <span className="w-4 h-4 rounded-full bg-success text-white text-[10px] font-bold flex items-center justify-center">B</span>
            Unique angle
          </div>
          <div className="text-textSecondary text-xs">{pair.b_unique_angle}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([
          { label: 'A', text: pair.a_text, expand: expandA, setExpand: setExpandA, color: 'text-accent' },
          { label: 'B', text: pair.b_text, expand: expandB, setExpand: setExpandB, color: 'text-success' },
        ] as const).map(({ label, text, expand, setExpand, color }) => (
          <div key={label} className="space-y-1">
            <button
              onClick={() => setExpand(!expand)}
              className={`flex items-center gap-1 text-xs font-medium ${color} hover:underline`}
            >
              {expand ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expand ? 'Hide' : 'Show'} chunk {label}
            </button>
            {expand && (
              <div className="text-xs bg-surfaceAlt border border-border rounded p-3 max-h-40 overflow-y-auto font-mono text-textSecondary whitespace-pre-wrap leading-relaxed">
                <HighlightedText text={text} shared={shared} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
