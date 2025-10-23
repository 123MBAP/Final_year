import { useEffect, useState } from 'react'
import { cn } from '../lib/utils'
import { onMqtt, sendControl, sendSettings, socket } from '../routes/mqtt'
import Knob from './Knob'

type Status = 'idle' | 'running' | 'stopped' | 'emergency'

export default function Dashboard() {
  const [connected, setConnected] = useState(false)
  const [weight, setWeight] = useState<number | null>(null)
  const [distance, setDistance] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [rpm, setRpm] = useState<number>(300)
  const [direction, setDirection] = useState<'FWD' | 'REV'>('FWD')
  const MIN_RPM = 0
  const MAX_RPM = 700

  useEffect(() => {
    // Map incoming socket-relayed MQTT messages to state
    const unsub = onMqtt((data: { topic: string; message: string }) => {
      const topic = String(data.topic || '')
      const payload = String(data.message || '')
      if (topic.endsWith('/weight') || topic === 'machine/weight') {
        const n = Number(payload)
        if (!Number.isNaN(n)) setWeight(n)
      } else if (topic.endsWith('/status') || topic === 'machine/status') {
        const sRaw = payload.toLowerCase()
        let s: Status = 'idle'
        if (sRaw.indexOf('run') !== -1) s = 'running'
        else if (sRaw.indexOf('done') !== -1) s = 'stopped'
        else if (sRaw.indexOf('emergency') !== -1) s = 'emergency'
        else s = 'idle'
        setStatus(s)
      } else if (topic.endsWith('/rpm') || topic === 'machine/rpm') {
        const n = Number(payload)
        if (!Number.isNaN(n)) setRpm(Math.min(MAX_RPM, Math.max(MIN_RPM, n)))
      } else if (topic.endsWith('/dir') || topic === 'machine/dir') {
        if (payload === 'FWD' || payload === 'REV') setDirection(payload as 'FWD' | 'REV')
      } else if (topic.endsWith('/distance') || topic === 'machine/distance') {
        if (payload === 'None' || payload === '') {
          setDistance(null)
        } else {
          const d = Number(payload)
          setDistance(Number.isNaN(d) ? null : d)
        }
      }
    })

    // wire socket connection status
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    // ensure the socket is connected (server connects automatically in dev)
    if (!socket.connected) socket.connect?.()

    return () => {
      unsub()
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      setConnected(false)
    }
  }, [])

  const sendCommand = (cmd: string, extra?: Record<string, any>) => {
    const payload = typeof cmd === 'string' && !extra ? cmd : { cmd, ...(extra || {}) }
    // route through server socket so we can publish via the backend
    sendControl(payload)
  }

  const changeRpm = (newRpm: number) => {
    const r = Math.max(MIN_RPM, Math.min(MAX_RPM, Math.round(newRpm)))
    setRpm(r)
    // send structured command via backend
    sendControl({ cmd: 'set_rpm', rpm: r })
    // optimistic local publish of rpm display via settings channel
    sendSettings({ rpm: r })
  }

  const toggleDirection = () => {
    const d = direction === 'FWD' ? 'REV' : 'FWD'
    setDirection(d)
    sendControl({ cmd: 'set_dir', dir: d })
    sendSettings({ dir: d })
  }

  const getStatusColor = (status: Status) => {
    switch (status) {
      case 'running': return 'bg-green-500'
      case 'emergency': return 'bg-red-500'
      case 'stopped': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-2 sm:p-3 md:p-4">
      <div className="max-w-6xl mx-auto min-h-screen flex flex-col">
        {/* Header - Responsive */}
        <header className="flex flex-col sm:flex-row items-center justify-between mb-3 p-3 sm:p-4 bg-gray-800 rounded-xl gap-2 sm:gap-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center font-bold text-white text-sm sm:text-base">
              FM
            </div>
            <div className="text-center sm:text-left">
              <h1 className="text-sm sm:text-lg font-bold whitespace-nowrap">FERROUS METAL SORTING SYSTEM</h1>
              <p className="text-xs text-gray-400 hidden xs:block">Real-time Machine Monitoring</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-2 h-2 sm:w-3 sm:h-3 rounded-full',
              connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            )} />
            <span className="text-xs sm:text-sm">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </header>

        {/* Main Content Grid - Responsive */}
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-12 gap-2 sm:gap-3 flex-1">
          {/* Weight Display */}
          <div className="xs:col-span-1 lg:col-span-4 bg-gray-800 rounded-xl p-3 sm:p-4 flex flex-col justify-center">
            <div className="text-center">
              {/* <div className="text-xs sm:text-sm text-gray-400 mb-1">Current Weight</div>
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">
                {weight !== null ? weight.toFixed(1) : '--'}
                <span className="text-sm sm:text-lg text-gray-400 ml-1">kg</span>
              </div> */}
              <div className="mt-2 text-center">
                <div className="text-4xl font-semibold text-gray-400">Distance</div>
                <div className="text-7xl font-bold text-white">{distance !== null ? (Number.isNaN(distance) ? '--' : distance.toFixed(1)) : '--'} <span className="text-2xl text-gray-400">cm</span></div>
              </div>
            </div>
          </div>

          {/* RPM Control */}
          <div className="xs:col-span-1 lg:col-span-4 bg-gray-800 rounded-xl p-2 sm:p-3 flex flex-col items-center justify-center">
            <div className="text-center mb-1 sm:mb-2">
              <div className="text-xs sm:text-sm text-gray-400">RPM Control</div>
              <div className="text-xs text-gray-500 hidden xs:block">0 - 700 RPM • 50 RPM Steps</div>
            </div>
            
            <div className="scale-75 xs:scale-90 sm:scale-100">
              <Knob 
                min={MIN_RPM} 
                max={MAX_RPM} 
                value={rpm} 
                onChange={changeRpm} 
                size={80}
              />
            </div>
            
            <div className="mt-1 sm:mt-2 bg-blue-600 rounded-lg px-2 sm:px-3 py-1">
              <span className="text-base sm:text-lg font-bold">{rpm}</span>
              <span className="text-blue-200 text-xs sm:text-sm ml-1">RPM</span>
            </div>
          </div>

          {/* Status Panel */}
          <div className="xs:col-span-2 lg:col-span-4 bg-gray-800 rounded-xl p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div className="col-span-2 sm:col-span-1 text-center">
                <div className="text-xs sm:text-sm text-gray-400 mb-1">Machine Status</div>
                <div className={cn(
                  'px-2 sm:px-3 py-2 rounded-lg font-bold text-xs sm:text-sm',
                  getStatusColor(status)
                )}>
                  {status.toUpperCase()}
                </div>
              </div>

              <div className="col-span-2 sm:col-span-1 text-center">
                <div className="text-xs sm:text-sm text-gray-400 mb-1">Direction</div>
                <div className="flex items-center justify-center gap-2">
                  <div className={cn(
                    'px-3 py-2 rounded-lg font-bold text-sm sm:text-base min-w-[64px] text-center shadow-sm',
                    direction === 'FWD' ? 'bg-blue-600' : 'bg-purple-600'
                  )}>
                    {direction}
                  </div>

                  <button
                    onClick={toggleDirection}
                    aria-label="Toggle direction"
                    title="Toggle direction"
                    className="inline-flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 bg-gray-700 hover:bg-gray-600 active:scale-95 rounded-lg text-white text-lg transition-transform shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400"
                  >
                    
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Command Buttons - Bottom Full Width */}
          <div className="xs:col-span-2 lg:col-span-12 bg-gray-800 rounded-xl p-3 sm:p-4">
            <div className="text-center mb-2 sm:mb-3">
              <div className="text-xs sm:text-sm text-gray-400">Machine Control</div>
              <div className="text-xs text-gray-500">Send commands to machine</div>
            </div>
            
            <div className="flex flex-col md:flex-row gap-3">
              <button
                onClick={() => sendCommand('start')}
                disabled={status === 'emergency'}
                aria-label="Start machine"
                className={cn(
                  'w-full md:flex-1 md:min-w-[180px] text-white py-3 rounded-full font-bold text-sm shadow-inner flex items-center justify-center gap-3 transition-transform active:translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2',
                  status === 'emergency'
                    ? 'bg-gray-600 border border-gray-500 cursor-not-allowed opacity-60'
                    : 'bg-gradient-to-r from-green-600 to-green-500 shadow-green-900/20 border border-green-700/40 hover:from-green-700 hover:to-green-600 focus:ring-green-300'
                )}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4L20 12L6 20V4Z" fill="currentColor"/></svg>
                <span>START</span>
              </button>

              <button
                onClick={() => sendCommand('stop')}
                disabled={status === 'emergency'}
                aria-label="Stop machine"
                className={cn(
                  'w-full md:flex-1 md:min-w-[180px] text-white py-3 rounded-full font-bold text-sm shadow-inner flex items-center justify-center gap-3 transition-transform active:translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2',
                  status === 'emergency'
                    ? 'bg-gray-600 border border-gray-500 cursor-not-allowed opacity-60'
                    : 'bg-gradient-to-r from-yellow-600 to-yellow-500 shadow-yellow-900/20 border border-yellow-700/40 hover:from-yellow-700 hover:to-yellow-600 focus:ring-yellow-300'
                )}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                <span>STOP</span>
              </button>

              <button
                onClick={() => sendCommand(status === 'emergency' ? 'clear_emergency' : 'emergency')}
                aria-label="Emergency stop"
                className={cn(
                  'w-full md:flex-1 md:min-w-[220px] text-white py-3 rounded-full font-bold text-sm shadow-inner flex items-center justify-center gap-3 transition-transform active:translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2',
                  status === 'emergency'
                    ? 'bg-gradient-to-r from-green-700 to-green-600 border border-green-700/40 focus:ring-green-300'
                    : 'bg-gradient-to-r from-red-600 to-red-500 border border-red-700/40 hover:from-red-700 hover:to-red-600 focus:ring-red-400'
                )}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM12 7v6l4 2" fill="currentColor"/></svg>
                <span>{status === 'emergency' ? 'Disable emergency' : 'EMERGENCY STOP'}</span>
              </button>
            </div>
            
            <div className="text-xs text-gray-500 text-center mt-2">
              Commands published to <span className="font-mono">machine/command</span>
            </div>
          </div>
        </div>

        {/* Footer - Minimal */}
        <footer className="text-center p-2 mt-2">
          <div className="text-xs text-gray-500">
            {new Date().toLocaleString()}
          </div>
        </footer>
      </div>
    </div>
  )
}