// "Ask the building" on the Live Twin page: the building Assistant in a card. It shares the conversation with
// the Assistant side panel, so a question asked here is there too.

import { Bot } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AssistantPanel } from '../assistant/AssistantPanel'

export function Copilot() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-5 text-highlight" aria-hidden /> Ask the building
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[min(60vh,520px)]">
        <AssistantPanel />
      </CardContent>
    </Card>
  )
}
