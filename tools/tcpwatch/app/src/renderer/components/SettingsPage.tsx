import { useEffect, useState } from 'react'
import type { AppConfig } from '../types'

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    window.tcpwatch
      .getSettings()
      .then((cfg) => {
        setConfig(cfg)
        setDraft(cfg)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const updateField = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    if (!draft) return
    setDraft({ ...draft, [key]: value })
    setDirty(true)
    setSuccess(null)
  }

  const onSave = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const saved = await window.tcpwatch.saveSettings(draft)
      setConfig(saved)
      setDraft(saved)
      setDirty(false)
      setSuccess('Settings saved. Some changes may require restarting the app.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const onReset = () => {
    if (config) {
      setDraft(config)
      setDirty(false)
      setSuccess(null)
    }
  }

  if (!draft) {
    return (
      <div className="panel">
        {error ? <div className="errorText">{error}</div> : <div>Loading settings...</div>}
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="controls">
        <div className="settingsSection">
          <h3 className="settingsHeading">API</h3>
          <div className="settingsRow">
            <label htmlFor="apiKey">Anthropic API Key</label>
            <div className="settingsApiKeyWrap">
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={draft.anthropicApiKey}
                onChange={(e) => updateField('anthropicApiKey', e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" onClick={() => setShowApiKey(!showApiKey)} title={showApiKey ? 'Hide' : 'Show'}>
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="settingsRow">
            <label htmlFor="claudeModel">Claude Model</label>
            <input
              id="claudeModel"
              type="text"
              value={draft.claudeModel}
              onChange={(e) => updateField('claudeModel', e.target.value)}
              placeholder="Auto-detect (leave empty)"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="settingsSection">
          <h3 className="settingsHeading">Binaries</h3>
          <div className="settingsRow">
            <label htmlFor="mcpcapBin">mcpcap Binary</label>
            <input
              id="mcpcapBin"
              type="text"
              value={draft.mcpcapBin}
              onChange={(e) => updateField('mcpcapBin', e.target.value)}
              placeholder="Auto-detect"
              spellCheck={false}
            />
          </div>
          <div className="settingsRow">
            <label htmlFor="tsharkBin">tshark Binary</label>
            <input
              id="tsharkBin"
              type="text"
              value={draft.tsharkBin}
              onChange={(e) => updateField('tsharkBin', e.target.value)}
              placeholder="Auto-detect"
              spellCheck={false}
            />
          </div>
          <div className="settingsRow">
            <label htmlFor="editcapBin">editcap Binary</label>
            <input
              id="editcapBin"
              type="text"
              value={draft.editcapBin}
              onChange={(e) => updateField('editcapBin', e.target.value)}
              placeholder="Auto-detect"
              spellCheck={false}
            />
          </div>
          <div className="settingsRow">
            <label htmlFor="wiresharkBin">Wireshark Binary</label>
            <input
              id="wiresharkBin"
              type="text"
              value={draft.wiresharkBin}
              onChange={(e) => updateField('wiresharkBin', e.target.value)}
              placeholder="Auto-detect"
              spellCheck={false}
            />
          </div>
          <div className="settingsRow">
            <label htmlFor="tcpwatchBin">tcpwatch Binary</label>
            <input
              id="tcpwatchBin"
              type="text"
              value={draft.tcpwatchBin}
              onChange={(e) => updateField('tcpwatchBin', e.target.value)}
              placeholder="Auto-detect"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="settingsSection">
          <h3 className="settingsHeading">Network</h3>
          <div className="settingsRow">
            <label>
              <input
                type="checkbox"
                checked={draft.reverseDns}
                onChange={(e) => updateField('reverseDns', e.target.checked)}
              />{' '}
              Enable Reverse DNS Lookups
            </label>
          </div>
        </div>

        <div className="settingsActions">
          <button className="primary" onClick={onSave} disabled={!dirty || saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onReset} disabled={!dirty}>
            Reset
          </button>
        </div>

        {error ? <div className="errorText">{error}</div> : null}
        {success ? <div className="settingsSuccess">{success}</div> : null}
        <div className="settingsNote">
          Empty fields use auto-detected defaults. Environment variables override config file values.
        </div>
      </div>
    </div>
  )
}
