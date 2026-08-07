'use client'

/**
 * VeriFace Edge — Command Palette (⌘K)
 *
 * Premium command palette using HeadlessUI Combobox.
 * Provides quick keyboard-driven access to all actions.
 *
 * Open: Cmd+K (Mac) / Ctrl+K (Windows)
 * Navigate: Arrow keys
 * Select: Enter
 * Close: Escape
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Combobox, Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import {
  UserPlus,
  LogIn,
  Trash2,
  Shield,
  Key,
  Activity,
  FileDown,
  Settings,
  Sun,
  Moon,
  Monitor,
  Command as CommandIcon,
} from 'lucide-react'

interface CommandItem {
  id: string
  name: string
  description?: string
  icon: ReactNode
  action: () => void
  keywords?: string[]
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onAction?: (actionId: string) => void
}

export function CommandPalette({ open, onClose, onAction }: CommandPaletteProps) {
  const [query, setQuery] = useState('')

  const commands: CommandItem[] = [
    {
      id: 'enroll',
      name: 'Enroll Face',
      description: 'Capture and store a new biometric template',
      icon: <UserPlus className="w-4 h-4 text-cyan-400" />,
      action: () => onAction?.('enroll'),
      keywords: ['register', 'signup', 'create', 'add user'],
    },
    {
      id: 'authenticate',
      name: 'Authenticate Face',
      description: 'Verify identity against stored template',
      icon: <LogIn className="w-4 h-4 text-emerald-400" />,
      action: () => onAction?.('authenticate'),
      keywords: ['login', 'verify', 'signin', 'auth'],
    },
    {
      id: 'delete',
      name: 'Delete Template (GDPR)',
      description: 'Right to be Forgotten — crypto-erasure',
      icon: <Trash2 className="w-4 h-4 text-red-400" />,
      action: () => onAction?.('delete'),
      keywords: ['gdpr', 'forget', 'revoke', 'remove'],
    },
    {
      id: 'export',
      name: 'Export Data (GDPR Art. 20)',
      description: 'Download all user data',
      icon: <FileDown className="w-4 h-4 text-blue-400" />,
      action: () => onAction?.('export'),
      keywords: ['portability', 'download', 'data'],
    },
    {
      id: 'audit',
      name: 'View Audit Log',
      description: 'Hash-chained audit trail',
      icon: <Shield className="w-4 h-4 text-purple-400" />,
      action: () => onAction?.('audit'),
      keywords: ['log', 'history', 'chain', 'security'],
    },
    {
      id: 'metrics',
      name: 'View Metrics',
      description: 'Prometheus metrics dashboard',
      icon: <Activity className="w-4 h-4 text-orange-400" />,
      action: () => onAction?.('metrics'),
      keywords: ['prometheus', 'monitoring', 'stats'],
    },
    {
      id: 'api-keys',
      name: 'Manage API Keys',
      description: 'Create, list, revoke keys',
      icon: <Key className="w-4 h-4 text-amber-400" />,
      action: () => onAction?.('api-keys'),
      keywords: ['token', 'secret', 'credentials'],
    },
    {
      id: 'settings',
      name: 'Settings',
      description: 'Tenant configuration',
      icon: <Settings className="w-4 h-4 text-slate-400" />,
      action: () => onAction?.('settings'),
      keywords: ['config', 'preferences'],
    },
    {
      id: 'theme-light',
      name: 'Theme: Light',
      icon: <Sun className="w-4 h-4 text-yellow-400" />,
      action: () => onAction?.('theme-light'),
      keywords: ['mode', 'appearance', 'bright'],
    },
    {
      id: 'theme-dark',
      name: 'Theme: Dark',
      icon: <Moon className="w-4 h-4 text-indigo-400" />,
      action: () => onAction?.('theme-dark'),
      keywords: ['mode', 'appearance', 'night'],
    },
    {
      id: 'theme-system',
      name: 'Theme: System',
      icon: <Monitor className="w-4 h-4 text-slate-400" />,
      action: () => onAction?.('theme-system'),
      keywords: ['auto', 'default', 'preference'],
    },
  ]

  const filtered = query
    ? commands.filter((c) => {
        const q = query.toLowerCase()
        return (
          c.name.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.keywords?.some((k) => k.includes(q))
        )
      })
    : commands

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) {
          onClose()
        } else {
          // Trigger open via callback
          onAction?.('open-palette')
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, onAction])

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-start justify-center p-4 pt-[20vh]">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95 translate-y-4"
              enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-xl transform overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-2xl shadow-2xl">
                <Combobox
                  onChange={(item: CommandItem | null) => {
                    if (item) {
                      item.action()
                      onClose()
                    }
                  }}
                >
                  <div className="flex items-center gap-3 border-b border-white/10 px-4">
                    <CommandIcon className="w-4 h-4 text-slate-500" />
                    <Combobox.Input
                      className="w-full bg-transparent py-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                      placeholder="Type a command or search..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoFocus
                    />
                    <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 font-mono text-[10px] text-slate-400">
                      ESC
                    </kbd>
                  </div>

                  <Combobox.Options className="max-h-80 overflow-y-auto p-2">
                    {filtered.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        No commands found
                      </div>
                    )}
                    {filtered.map((cmd) => (
                      <Combobox.Option
                        key={cmd.id}
                        value={cmd}
                        className={({ active }) =>
                          `group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${
                            active ? 'bg-white/10' : ''
                          }`
                        }
                      >
                        {({ active }) => (
                          <>
                            <div className="flex-shrink-0">{cmd.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-200'}`}>
                                {cmd.name}
                              </div>
                              {cmd.description && (
                                <div className="text-xs text-slate-500 truncate">
                                  {cmd.description}
                                </div>
                              )}
                            </div>
                            {active && (
                              <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 font-mono text-[10px] text-slate-400">
                                ↵
                              </kbd>
                            )}
                          </>
                        )}
                      </Combobox.Option>
                    ))}
                  </Combobox.Options>
                </Combobox>

                <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[10px] text-slate-500">
                  <div className="flex items-center gap-3">
                    <span><kbd className="font-mono">↑↓</kbd> Navigate</span>
                    <span><kbd className="font-mono">↵</kbd> Select</span>
                    <span><kbd className="font-mono">ESC</kbd> Close</span>
                  </div>
                  <span>VeriFace Edge</span>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
