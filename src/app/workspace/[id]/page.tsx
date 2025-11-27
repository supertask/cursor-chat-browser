"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from "@/components/ui/card"
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp } from "lucide-react"
import Link from "next/link"
import { Loading } from "@/components/ui/loading"
import { DownloadMenu } from "@/components/download-menu"
import ReactMarkdown from "react-markdown"
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { ChatTab, ComposerChat } from "@/types/workspace"
import { Badge } from "@/components/ui/badge"
import { CopyButton } from "@/components/copy-button"
import { format } from 'date-fns'

interface WorkspaceState {
  projectName: string;
  tabs: ChatTab[];
  composers: ComposerChat[];
  selectedId: string | null;
  isLoading: boolean;
  isChatLoading: boolean;
  isRefreshing: boolean;
}

interface MessageBubbleProps {
  bubble: {
    type: 'user' | 'ai'
    text: string
    timestamp: number
  }
}

const MarkdownContent = ({ content }: { content: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      code({ inline, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '')
        return !inline && match ? (
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={match[1]}
            PreTag="div"
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        ) : (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
    }}
  >
    {content}
  </ReactMarkdown>
)

const UserMessage = ({ bubble }: MessageBubbleProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  // Simple heuristic: if text is short, don't collapse.
  // Adjust threshold as needed. 
  const isShort = bubble.text.length < 300 && !bubble.text.includes('\n\n')
  
  // If it's short, we default to expanded (or rather, no collapse logic needed).
  // But user asked for "fixed height and more button". 
  // Let's apply collapse logic only if it exceeds a certain length.
  
  const showToggle = !isShort

  return (
    <div className="bg-blue-50 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800 p-4 transition-all">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="default">You</Badge>
        <span className="text-sm text-muted-foreground">
          {format(new Date(bubble.timestamp), 'PPp')}
        </span>
      </div>
      
      <div className={`prose dark:prose-invert max-w-none relative ${!isExpanded && showToggle ? 'max-h-[120px] overflow-hidden' : ''}`}>
        <MarkdownContent content={bubble.text} />
        
        {!isExpanded && showToggle && (
           <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-blue-50 to-transparent dark:from-blue-950/20 pointer-events-none" />
        )}
      </div>

      {showToggle && (
        <div className="mt-2 flex justify-center">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-6 text-xs text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <>Show less <ChevronUp className="ml-1 w-3 h-3" /></>
            ) : (
              <>Show more <ChevronDown className="ml-1 w-3 h-3" /></>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

const AiMessage = ({ bubble }: MessageBubbleProps) => {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 p-4 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="secondary">AI</Badge>
        <span className="text-sm text-muted-foreground">
          {format(new Date(bubble.timestamp), 'PPp')}
        </span>
      </div>
      <div className="prose dark:prose-invert max-w-none">
        <MarkdownContent content={bubble.text} />
      </div>
    </div>
  )
}

const MessageGroup = ({ userBubble, aiBubbles }: { userBubble?: MessageBubbleProps['bubble'], aiBubbles: MessageBubbleProps['bubble'][] }) => {
  return (
    <div className="relative isolate group-section">
      {userBubble && (
        <div className="sticky top-0 z-10 shadow-sm">
          {/* User message is now sticky. We use the UserMessage component which handles background and styling. */}
          <UserMessage bubble={userBubble} />
        </div>
      )}
      
      {aiBubbles.length > 0 && (
        <div className="p-4 space-y-4">
          {aiBubbles.map((bubble, idx) => (
            <AiMessage key={idx} bubble={bubble} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function WorkspacePage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams()
  const [state, setState] = useState<WorkspaceState>({
    projectName: params.id === 'global' ? 'Global Storage' : `Project ${params.id.slice(0, 8)}`,
    tabs: [],
    composers: [],
    selectedId: searchParams.get('tab'),
    isLoading: true,
    isChatLoading: false,
    isRefreshing: false
  })

  const fetchChatDetails = async (tabId: string) => {
    try {
        setState(prev => ({ ...prev, isChatLoading: true }))
        const res = await fetch(`/api/workspaces/${params.id}/tabs/${tabId}`)
        const data = await res.json()
        
        setState(prev => ({
            ...prev,
            tabs: prev.tabs.map(tab => 
                tab.id === tabId ? { ...tab, ...data } : tab
            ),
            isChatLoading: false
        }))
    } catch (error) {
        console.error('Failed to fetch chat details:', error)
        setState(prev => ({ ...prev, isChatLoading: false }))
    }
  }

  const handleSelect = async (id: string) => {
    setState(prev => ({ ...prev, selectedId: id }))
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.pushState({}, '', url.toString())

    const selectedTab = state.tabs.find(tab => tab.id === id)
    if (selectedTab && (!selectedTab.bubbles || selectedTab.bubbles.length === 0)) {
        await fetchChatDetails(id)
    }
  }

  const fetchWorkspace = useCallback(async () => {
    try {
      const tabsRes = await fetch(`/api/workspaces/${params.id}/tabs?mode=list`)
      const data = await tabsRes.json()

      setState(prev => ({
        ...prev,
        tabs: (data.tabs || []).sort((a: ChatTab, b: ChatTab) => b.timestamp - a.timestamp),
        composers: data.composers?.allComposers || [],
        isLoading: false
      }))
      
      const selectedId = searchParams.get('tab')
      if (selectedId) {
          fetch(`/api/workspaces/${params.id}/tabs/${selectedId}`)
            .then(res => res.json())
            .then(detailData => {
                setState(prev => ({
                    ...prev,
                    tabs: prev.tabs.map(tab => 
                        tab.id === selectedId ? { ...tab, ...detailData } : tab
                    )
                }))
            })
            .catch(console.error)
      }

    } catch (error) {
      console.error('Failed to fetch workspace:', error)
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }, [params.id, searchParams])

  const handleRefreshDb = async () => {
    try {
      setState(prev => ({ ...prev, isRefreshing: true }))
      await fetch('/api/refresh-db', { method: 'POST' })
      await fetchWorkspace()
    } catch (error) {
      console.error('Failed to refresh DB:', error)
    } finally {
      setState(prev => ({ ...prev, isRefreshing: false }))
    }
  }

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  useEffect(() => {
    if (!state.selectedId && state.tabs.length > 0) {
        const firstId = state.tabs[0].id
        handleSelect(firstId)
    }
  }, [state.tabs, state.selectedId])

  // Group bubbles Logic
  const selectedChat = state.tabs.find(tab => tab.id === state.selectedId)
  
  const groupedBubbles = useMemo(() => {
    if (!selectedChat?.bubbles) return []
    
    const groups: { userBubble?: MessageBubbleProps['bubble'], aiBubbles: MessageBubbleProps['bubble'][] }[] = []
    let currentGroup: typeof groups[0] | null = null

    selectedChat.bubbles.filter(b => b.text && b.text.trim().length > 0).forEach(bubble => {
        if (bubble.type === 'user') {
            // Start new group
            currentGroup = { userBubble: bubble, aiBubbles: [] }
            groups.push(currentGroup)
        } else {
            // AI message
            if (currentGroup) {
                currentGroup.aiBubbles.push(bubble)
            } else {
                // Orphaned AI message at start
                currentGroup = { userBubble: undefined, aiBubbles: [bubble] }
                groups.push(currentGroup)
            }
        }
    })
    return groups
  }, [selectedChat?.bubbles])


  if (state.isLoading) {
    return <Loading />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex justify-between w-full">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" asChild className="gap-2">
                <Link href="/">
                <ArrowLeft className="w-4 h-4" />
                Back to Projects
                </Link>
            </Button>
          </div>
          <div className="flex gap-2">
            <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRefreshDb}
                disabled={state.isRefreshing}
                className="gap-2"
            >
                <RefreshCw className={`w-4 h-4 ${state.isRefreshing ? 'animate-spin' : ''}`} />
                {state.isRefreshing ? 'Refreshing...' : 'Refresh DB'}
            </Button>
            {selectedChat && <CopyButton tab={selectedChat} />}
            {selectedChat && <DownloadMenu tab={selectedChat} />}
          </div>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <div className="w-80 shrink-0 sticky top-4 h-[calc(100vh-2rem)] flex flex-col gap-4 overflow-hidden">
          <div className="bg-muted/50 dark:bg-muted/10 p-4 rounded-lg border shrink-0">
            <h2 className="font-semibold mb-1 truncate" title={state.projectName}>{state.projectName}</h2>
            <p className="text-xs text-muted-foreground">
              {state.tabs.length} conversations
            </p>
          </div>

          {state.tabs.length > 0 && (
            <div className="flex flex-col min-h-0 overflow-hidden flex-1">
              <h2 className="text-lg font-bold shrink-0 mb-2">Conversations</h2>
              <div className="space-y-2 flex-1 overflow-y-auto pr-2 min-h-0">
                {state.tabs.map((tab) => (
                  <Button
                    key={tab.id}
                    variant={state.selectedId === tab.id ? "default" : "outline"}
                    className="w-full justify-start px-4 py-3 h-auto"
                    onClick={() => handleSelect(tab.id)}
                    title={tab.title}
                  >
                    <div className="text-left w-full overflow-hidden">
                      <div className="font-medium truncate">
                        {tab.title || `Chat ${tab.id.slice(0, 8)}`}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {new Date(tab.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {selectedChat ? (
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b bg-card">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold truncate pr-4">
                    {selectedChat.title}
                    </h2>
                    <Badge variant="default" className="shrink-0">
                    Conversation
                    </Badge>
                </div>
              </div>

              <div className="bg-card min-h-[500px]">
                {state.isChatLoading && (!selectedChat.bubbles || selectedChat.bubbles.length === 0) ? (
                    <div className="flex justify-center items-center py-12">
                        <Loading message="Loading chat details..." />
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {groupedBubbles.map((group, index) => (
                            <MessageGroup 
                                key={index} 
                                userBubble={group.userBubble} 
                                aiBubbles={group.aiBubbles} 
                            />
                        ))}
                    </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <div className="text-center text-muted-foreground">
                <p>No conversation selected</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
