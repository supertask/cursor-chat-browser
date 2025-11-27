"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState, useEffect } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { expandTildePath } from "@/utils/path"

// Function to detect OS, WSL and remote SSH
async function detectEnvironment(): Promise<{ os: string, isWSL: boolean, isRemote: boolean }> {
  try {
    const response = await fetch('/api/detect-environment')
    return await response.json()
  } catch (error) {
    console.error('Failed to detect environment:', error)
    return { os: 'unknown', isWSL: false, isRemote: false }
  }
}

async function getWindowsUsername(): Promise<string> {
  try {
    const response = await fetch('/api/get-username')
    const data = await response.json()
    return data.username || 'YOUR_USERNAME'
  } catch (error) {
    console.error('Failed to get username:', error)
    return 'YOUR_USERNAME'
  }
}

export default function ConfigPage() {
  const router = useRouter()
  const [config, setConfig] = useState({
    workspacePath: '',
    allowedProjects: [] as string[]
  })
  const [newProject, setNewProject] = useState('')
  const [status, setStatus] = useState<{
    type: 'error' | 'success' | null;
    message: string;
  }>({ type: null, message: '' })

  useEffect(() => {
    const initConfig = async () => {
      // Get stored path or detect environment
      const storedPath = localStorage.getItem('workspacePath')
      let currentConfig = { workspacePath: storedPath || '', allowedProjects: [] as string[] }

      // Load config.json if it exists
      try {
        const response = await fetch('/api/config')
        if (response.ok) {
          const configData = await response.json()
          currentConfig.allowedProjects = configData.allowedProjects || []
        }
      } catch (error) {
        console.error('Failed to load config:', error)
      }

      if (storedPath) {
        setConfig(currentConfig)
        return
      }

      // Detect environment and set path
      const { os, isWSL, isRemote } = await detectEnvironment()
      const detectedUsername = await getWindowsUsername()
      let detectedPath = ''
      
      if (isWSL) {
        detectedPath = `/mnt/c/Users/${detectedUsername}/AppData/Roaming/Cursor/User/workspaceStorage`
      } else if (os === 'win32') {
        detectedPath = `C:\\Users\\${detectedUsername}\\AppData\\Roaming\\Cursor\\User\\workspaceStorage`
      } else if (os === 'darwin') {
        detectedPath = '~/Library/Application Support/Cursor/User/workspaceStorage'
      } else if (os === 'linux') {
        if (isRemote) {
          detectedPath = '~/.cursor-server/data/User/workspaceStorage'
        } else {
          detectedPath = '~/.config/Cursor/User/workspaceStorage'
        }
      }

      // Try to validate the detected path
      if (detectedPath) {
        try {
          const expandedPath = expandTildePath(detectedPath)
          const response = await fetch('/api/validate-path', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: expandedPath }),
          })

          const data = await response.json()

          if (data.valid) {
            localStorage.setItem('workspacePath', expandedPath)
            document.cookie = `workspacePath=${encodeURIComponent(expandedPath)}; path=/`
            router.push('/')
            return
          }
        } catch (error) {
          console.error('Failed to validate detected path:', error)
        }
      }
      setConfig({ ...currentConfig, workspacePath: detectedPath })
    }

    initConfig()
  }, [router])

  const addProject = () => {
    if (newProject.trim() && !config.allowedProjects.includes(newProject.trim())) {
      setConfig({
        ...config,
        allowedProjects: [...config.allowedProjects, newProject.trim()]
      })
      setNewProject('')
    }
  }

  const removeProject = (project: string) => {
    setConfig({
      ...config,
      allowedProjects: config.allowedProjects.filter(p => p !== project)
    })
  }

  const validateAndSave = async () => {
    try {
      const expandedPath = expandTildePath(config.workspacePath)
      
      const response = await fetch('/api/validate-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: expandedPath }),
      })

      const data = await response.json()

      if (data.valid) {
        localStorage.setItem('workspacePath', expandedPath)
        document.cookie = `workspacePath=${encodeURIComponent(expandedPath)}; path=/`
        
        await fetch('/api/set-workspace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: expandedPath }),
        })

        // Save config.json
        await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            allowedProjects: config.allowedProjects
          }),
        })
        
        setStatus({
          type: 'success',
          message: `Found ${data.workspaceCount} workspaces in the specified location`
        })
        
        setTimeout(() => {
          router.push('/')
        }, 1000)
      } else {
        setStatus({
          type: 'error',
          message: 'No workspaces found in the specified location'
        })
      }
    } catch (error) {
      console.error('Validation error:', error)
      setStatus({
        type: 'error',
        message: 'Failed to validate path. Please check if the path exists and is accessible.'
      })
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Configuration</h1>
      
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Cursor Workspace Path
          </label>
          <Input
            value={config.workspacePath}
            onChange={(e) => setConfig({ ...config, workspacePath: e.target.value })}
            placeholder="/path/to/cursor/workspaces"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Path to your Cursor workspace storage directory
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Allowed Projects (Optional)
          </label>
          <p className="text-sm text-muted-foreground mb-3">
            Only show conversations from these projects. Leave empty to show all projects.
          </p>

          <div className="flex gap-2 mb-3">
            <Input
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              placeholder="Enter project name"
              onKeyPress={(e) => e.key === 'Enter' && addProject()}
            />
            <Button onClick={addProject} variant="outline">
              Add Project
            </Button>
          </div>

          <div className="space-y-2">
            {config.allowedProjects.map((project) => (
              <div key={project} className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="text-sm">{project}</span>
                <Button
                  onClick={() => removeProject(project)}
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                >
                  Remove
                </Button>
              </div>
            ))}
            {config.allowedProjects.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                No projects configured - all projects will be shown
              </p>
            )}
          </div>
        </div>

        {status.type && (
          <Alert variant={status.type === 'error' ? 'destructive' : 'default'}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-4">
          <Button onClick={validateAndSave}>
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  )
} 