// Ctrl+K (Cmd+K on a Mac): jump to any room or page, or run a common action, from the keyboard.

import { Bot, DoorOpen, Moon, Power, QrCode, Smartphone } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { useSite } from '@/shared/site'
import { useTwin } from '@/twin/store'
import { NAV } from '../nav'
import { STATUS } from './status'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAssistant: () => void
  onTheme: () => void
  onInvite: () => void
}

export function CommandPalette({ open, onOpenChange, onAssistant, onTheme, onInvite }: Props) {
  const navigate = useNavigate()
  const rooms = useSite((s) => s.site.rooms)
  const live = useTwin((s) => s.rooms)
  const alerts = useTwin((s) => s.alerts)
  const wasting = alerts.filter((a) => a.type === 'empty_with_load')
  const switchOff = useTwin((s) => s.switchOff)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search Pratibimb" description="Jump to a room or page, or run an action">
      <Command>
        <CommandInput placeholder="Search rooms, pages and actions" />
        <CommandList>
          <CommandEmpty>Nothing matches. Try a room id, a page name or "switch off".</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={run(onAssistant)} keywords={['ask', 'help', 'question', 'copilot']}>
              <Bot aria-hidden /> Ask the Assistant
            </CommandItem>
            {wasting.length > 0 && (
              <CommandItem onSelect={run(() => wasting.forEach((a) => void switchOff(a.roomId, 'all')))} keywords={['switch off', 'waste', 'power']}>
                <Power aria-hidden /> Switch off {wasting.length} empty {wasting.length === 1 ? 'room' : 'rooms'} wasting power
              </CommandItem>
            )}
            <CommandItem onSelect={run(onInvite)} keywords={['invite', 'qr', 'device', 'share']}>
              <QrCode aria-hidden /> Invite a device or show the public view code
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/live'))} keywords={['public', 'visitor', 'notice board']}>
              <Smartphone aria-hidden /> Open the public view
            </CommandItem>
            <CommandItem onSelect={run(onTheme)} keywords={['dark', 'light', 'theme']}>
              <Moon aria-hidden /> Switch light or dark theme
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          {NAV.map((g) => (
            <CommandGroup key={g.group} heading={g.group}>
              {g.pages.map((p) => (
                <CommandItem key={p.to} value={`${g.group} ${p.label}`} keywords={p.keywords?.split(' ')} onSelect={run(() => navigate(p.to))}>
                  <p.icon aria-hidden /> {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {rooms.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Rooms">
                {rooms.map((r) => {
                  const s = STATUS[live[r.id]?.status ?? 'unknown']
                  return (
                    <CommandItem key={r.id} value={`room ${r.id} ${r.name}`} onSelect={run(() => navigate(`/room/${r.id}`))}>
                      <DoorOpen aria-hidden />
                      <span className="num">{r.id}</span>
                      <span className="truncate text-muted-foreground">{r.name}</span>
                      <span className={`ml-auto flex items-center gap-1 text-xs ${s.text}`}>
                        <s.icon aria-hidden /> {s.label}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
