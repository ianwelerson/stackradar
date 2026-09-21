import { useId, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { useTracking } from '@/hooks/useTracking';
import { normalizeRestUrl, UpstashError, validateToken } from '@/lib/upstash';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

const TRUST_POINTS: readonly string[] = [
  'Your REST URL and token are held in this browser’s local storage and sent only from your browser, straight to Upstash.',
  'Stack Radar has no server-side account for you — there is nothing here that could see, log or proxy your credentials or your notes.',
  'Disconnect at any time: the credentials are wiped from this browser and the data stays in the database you own.',
];

const SETUP_STEPS: readonly string[] = [
  'Create a free account at upstash.com — no card required.',
  'Create a new Redis database in the region closest to you.',
  'Open the database, scroll to the REST API section, and copy the UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN values.',
  'Paste both below and connect. Nothing is written until you track a company or save a note.',
];

export function StorageModal({ open, onClose }: Props) {
  const { connected, failing, syncError, syncState, connect, disconnect, retry, maskedCredentials, tracking } =
    useTracking();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const noteCount = Object.keys(tracking.notes).length;
  const trackedCount = Object.keys(tracking.statuses).length;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    let credentials;
    try {
      credentials = { url: normalizeRestUrl(url), token: validateToken(token) };
    } catch (validationError) {
      setError(
        validationError instanceof UpstashError
          ? validationError.message
          : 'Those credentials look wrong.',
      );
      return;
    }

    setBusy(true);
    try {
      await connect(credentials);
      setUrl('');
      setToken('');
      onClose();
    } catch (connectError) {
      setError(
        connectError instanceof UpstashError
          ? connectError.message
          : 'Could not connect to that database.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} maxWidth={520}>
      <div className="px-5 py-[18px] border-b border-line-modal flex items-start gap-3 flex-none">
        <div className="flex-1">
          <h2 id={titleId} className="text-[16px] font-semibold tracking-[-0.01em] m-0">
            {connected ? 'Your storage' : 'Connect your own storage'}
          </h2>
          <p className="font-mono text-[11px] text-ink-faint mt-1 m-0">
            optional · upstash redis · client-side only
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="bg-transparent border-none text-ink-faint text-[15px] cursor-pointer px-1 py-[2px] hover:text-ink-strong"
        >
          ✕
        </button>
      </div>

      <div className="overflow-auto scrollbar-thin">
        {connected ? (
          <div className="p-5 flex flex-col gap-4">
            <div
              className={`flex items-start gap-[10px] rounded-[10px] px-[14px] py-[13px] border ${
                failing
                  ? 'bg-danger-surface border-danger-line'
                  : 'bg-accent-surface border-accent-line'
              }`}
            >
              <span
                className="w-[7px] h-[7px] rounded-full flex-none mt-[6px]"
                style={{
                  background: failing ? 'var(--color-danger-bright)' : 'oklch(0.80 0.15 162)',
                }}
              />
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[13.5px] font-medium ${
                    failing ? 'text-danger-bright' : 'text-accent-text-bright'
                  }`}
                >
                  {failing ? 'Connected, but not syncing' : 'Connected and syncing'}
                </div>
                <div
                  className={`font-mono text-[11px] mt-[3px] truncate ${
                    failing ? 'text-danger-text' : 'text-accent-text-soft'
                  }`}
                >
                  {maskedCredentials}
                </div>
                {failing && (
                  <p className="text-[12.5px] text-danger-text m-0 mt-[8px] text-pretty leading-[1.5]">
                    {syncError ??
                      'The last write to your database did not go through.'}{' '}
                    Your changes are still saved in this browser, so nothing is lost — but they
                    are not reaching your database until this is fixed.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-px grid-cols-[repeat(auto-fit,minmax(min(100%,120px),1fr))] bg-line border border-line rounded-[10px] overflow-hidden">
              {[
                { k: 'Notes', v: String(noteCount) },
                { k: 'Tracked', v: String(trackedCount) },
                { k: 'Stored at', v: failing ? 'this browser' : 'your database' },
              ].map((stat) => (
                <div key={stat.k} className="bg-surface-alt px-[14px] py-3">
                  <div className="font-mono text-[10.5px] text-ink-faint uppercase tracking-[0.06em]">
                    {stat.k}
                  </div>
                  <div className="text-[14px] mt-[5px]">{stat.v}</div>
                </div>
              ))}
            </div>

            <p className="text-[12.5px] text-ink-dim text-pretty m-0">
              Your profile, notes and tracked companies are written to your own database.
              Disconnecting clears the credentials from this browser; the data stays in your Redis
              instance.
            </p>

            <div className="flex gap-2 flex-wrap">
              {failing && (
                <button
                  type="button"
                  onClick={retry}
                  disabled={syncState === 'syncing'}
                  className="bg-accent-surface border border-accent-line text-accent-text-bright rounded-[8px] px-[14px] py-[9px] text-[12.5px] cursor-pointer disabled:opacity-50 disabled:cursor-default hover:bg-accent-surface-strong transition-colors"
                >
                  {syncState === 'syncing' ? 'Retrying…' : 'Retry now'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  onClose();
                }}
                className="bg-danger-surface border border-danger-line text-danger-text rounded-[8px] px-[14px] py-[9px] text-[12.5px] cursor-pointer"
              >
                Disconnect &amp; clear credentials
              </button>
              <button
                type="button"
                onClick={onClose}
                className="bg-control border border-line-control text-ink-soft rounded-[8px] px-[14px] py-[9px] text-[12.5px] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className="p-5 flex flex-col gap-[18px]" onSubmit={(e) => void handleSubmit(e)}>
            <p className="text-[13.5px] text-ink-muted leading-[1.6] text-pretty m-0">
              Stack Radar works fine without this. Connecting a database of your own adds
              persistence:{' '}
              <span className="text-ink-strong">
                notes on companies and your tracked list
              </span>{' '}
              come back the next time you visit — on any browser you connect.
            </p>

            <div className="border border-line-strong bg-surface-alt rounded-[10px] px-[15px] py-[14px] flex flex-col gap-[9px]">
              <div className="font-mono text-[10.5px] text-accent-text uppercase tracking-[0.07em]">
                Where your data lives
              </div>
              {TRUST_POINTS.map((point) => (
                <div key={point} className="flex gap-[9px] text-[12.5px] text-ink-muted leading-[1.55]">
                  <span className="text-accent flex-none">—</span>
                  <span className="text-pretty">{point}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[10px]">
              <div className="text-[13px] font-semibold">Setup — about two minutes</div>
              {SETUP_STEPS.map((step, index) => (
                <div key={step} className="flex gap-[11px] items-start">
                  <div className="w-[19px] h-[19px] flex-none rounded-[5px] bg-elevated border border-line-raised flex items-center justify-center font-mono text-[10.5px] text-accent-text mt-px">
                    {index + 1}
                  </div>
                  <div className="text-[12.5px] text-ink-muted leading-[1.55] text-pretty">
                    {step}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[10px]">
              <label className="flex flex-col gap-[6px]">
                <span className="font-mono text-[11px] text-ink-dimmer">
                  UPSTASH_REDIS_REST_URL
                </span>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://your-db-12345.upstash.io"
                  autoComplete="off"
                  spellCheck={false}
                  className="bg-input border border-line-control rounded-[8px] px-3 py-[10px] text-ink-strong font-mono text-[12.5px] w-full focus:border-accent-bar"
                />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="font-mono text-[11px] text-ink-dimmer">
                  UPSTASH_REDIS_REST_TOKEN
                </span>
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  placeholder="AX••••••••••••••••••••••"
                  autoComplete="off"
                  spellCheck={false}
                  className="bg-input border border-line-control rounded-[8px] px-3 py-[10px] text-ink-strong font-mono text-[12.5px] w-full focus:border-accent-bar"
                />
              </label>
              <p className="font-mono text-[10.5px] text-ink-fainter leading-[1.5] m-0">
                A REST token has full access to that database — use one created for a
                database you keep just for this.
              </p>
              {error !== null && (
                <div role="alert" className="text-[12px] text-danger-bright font-mono">
                  {error}
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <button
                type="submit"
                disabled={busy}
                className="bg-accent border-none text-accent-ink rounded-[8px] px-4 py-[10px] text-[13px] font-medium cursor-pointer hover:bg-accent-hover disabled:opacity-60 disabled:cursor-wait transition-colors"
              >
                {busy ? 'Connecting…' : 'Connect database'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="bg-transparent border border-line-strong text-ink-muted rounded-[8px] px-[14px] py-[10px] text-[13px] cursor-pointer hover:text-ink-strong"
              >
                Not now
              </button>
              <span className="font-mono text-[11px] text-ink-fainter ml-auto">
                free tier is plenty
              </span>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
