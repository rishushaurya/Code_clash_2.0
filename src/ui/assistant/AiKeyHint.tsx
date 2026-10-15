// Shown wherever an AI feature could not use the AI: no key for this workspace, or the provider refused the key.
// The templates still answered; this says how to get the AI back.

import { KeyRound } from 'lucide-react'
import { Link } from 'react-router'

export function AiKeyHint({ problem }: { problem: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-ai/30 bg-ai/5 p-2.5 text-xs">
      <KeyRound className="mt-0.5 size-3.5 shrink-0 text-ai" aria-hidden />
      <span>
        {problem === 'no-key' ? 'Add an AI key in ' : `${problem}. Check it in `}
        <Link to="/settings/keys" className="font-medium text-ai underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
          Settings, Keys and AI
        </Link>
        {problem === 'no-key' ? ' for AI answers; these were written by code meanwhile.' : '.'}
      </span>
    </p>
  )
}
