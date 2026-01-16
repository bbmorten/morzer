import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PacketAnalysisResult } from '../types'

export function PacketAnalysisPage({
  result,
  loading,
  error,
  onBack,
  onRerun,
}: {
  result: PacketAnalysisResult | null
  loading: boolean
  error: string | null
  onBack: () => void
  onRerun: () => void
}) {
  return (
    <div className="panel">
      <div className="controls">
        <div className="capGridAll">
          <div className="sub mb6">Packet Analysis (Claude + mcpcap)</div>
          {error ? <div className="sub errorText">{error}</div> : null}
        </div>

        <div className="capGridSpan3">
          <label>File</label>
          <div className="sub capEllipsis" title={result?.filePath || ''}>
            {result?.filePath || '—'}
          </div>
        </div>

        <div>
          <label>Actions</label>
          <div className="capRowFlex">
            <button onClick={onBack}>Back</button>
            <button className="primary" onClick={onRerun} disabled={loading || !result?.filePath}>
              {loading ? 'Analyzing…' : 'Re-run'}
            </button>
          </div>
        </div>

        <div className="capGridFrom4">
          <label>Generated</label>
          <div className="sub">{result?.generatedAt ? new Date(result.generatedAt).toLocaleString() : '—'}</div>
          <div className="sub">{result?.model ? `Model: ${result.model}` : ''}</div>
        </div>
      </div>

      {loading ? <div className="sub capPad12">Analyzing capture…</div> : null}

      {result && !loading ? (
        <div className="capAnalysisWrap">
          <div className="capAnalysisMarkdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.text}</ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  )
}
