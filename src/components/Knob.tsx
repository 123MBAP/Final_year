import { useEffect, useRef, useState } from 'react'

type KnobProps = {
  min?: number
  max?: number
  value: number
  onChange: (v: number) => void
  size?: number
}

export default function Knob({ min = 0, max = 700, value, onChange, size = 200 }: KnobProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [angle, setAngle] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Calculate steps (50 RPM increments)
  const steps = 15 // (700 - 0) / 50 = 14 + 1 for 0 = 15 total steps
  const stepSize = 50

  useEffect(() => {
    // Map value to angle (-135 to 135) with steps
    const step = Math.round((value - min) / stepSize)
    const steppedValue = min + (step * stepSize)
    const a = ((steppedValue - min) / (max - min)) * 270 - 135
    setAngle(a)
  }, [value, min, max, stepSize])

  const calcValueFromEvent = (e: MouseEvent | Touch) => {
    const el = ref.current
    if (!el) return value
    
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const x = ('clientX' in e) ? (e as MouseEvent).clientX : (e as Touch).clientX
    const y = ('clientY' in e) ? (e as MouseEvent).clientY : (e as Touch).clientY
    const dx = x - cx
    const dy = y - cy
    let a = Math.atan2(dy, dx) * (180 / Math.PI)
    
    // Convert to 0..360
    a = a < 0 ? 360 + a : a
    // Convert to -180..180 and clamp to -135..135
    let adj = a > 180 ? a - 360 : a
    adj = Math.max(-135, Math.min(135, adj))
    
    // Calculate value and snap to nearest step
    const rawValue = ((adj + 135) / 270) * (max - min) + min
    const step = Math.round((rawValue - min) / stepSize)
    let steppedValue = min + (step * stepSize)
    
    // Ensure value stays within 0-700 range
    steppedValue = Math.max(min, Math.min(max, steppedValue))
    
    return steppedValue
  }

  const handleStepChange = (direction: 'up' | 'down') => {
    const currentStep = Math.round((value - min) / stepSize)
    let newStep = direction === 'up' ? currentStep + 1 : currentStep - 1
    newStep = Math.max(0, Math.min(steps - 1, newStep))
    const newValue = min + (newStep * stepSize)
    onChange(newValue)
  }

  useEffect(() => {
    const onDown = (ev: MouseEvent | TouchEvent) => {
      ev.preventDefault()
      setIsDragging(true)
    }
    
    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDragging) return
      const e = ('touches' in ev) ? ev.touches[0] : ev as MouseEvent
      const v = calcValueFromEvent(e as any)
      onChange(v)
    }
    
    const onUp = () => { setIsDragging(false) }

    const el = ref.current
    if (!el) return
    
    el.addEventListener('mousedown', onDown as any)
    window.addEventListener('mousemove', onMove as any)
    window.addEventListener('mouseup', onUp as any)
    el.addEventListener('touchstart', onDown as any, { passive: false } as any)
    window.addEventListener('touchmove', onMove as any)
    window.addEventListener('touchend', onUp as any)

    return () => {
      el.removeEventListener('mousedown', onDown as any)
      window.removeEventListener('mousemove', onMove as any)
      window.removeEventListener('mouseup', onUp as any)
      el.removeEventListener('touchstart', onDown as any)
      window.removeEventListener('touchmove', onMove as any)
      window.removeEventListener('touchend', onUp as any)
    }
  }, [isDragging, min, max, onChange])

  // Generate step markers
  const stepMarkers = Array.from({ length: steps }, (_, i) => {
    const stepValue = min + (i * stepSize)
    const stepAngle = ((stepValue - min) / (max - min)) * 270 - 135
    const isActive = value >= stepValue
    
    return {
      angle: stepAngle,
      isActive,
      value: stepValue
    }
  })

  const half = size / 2
  const pointerHeight = Math.max(6, half - 45) // ensure positive height for small sizes

  return (
    <div className="select-none flex flex-col items-center p-6 bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl shadow-2xl border border-slate-700">
      {/* Title */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">RPM Control</h2>
        <div className="text-slate-400 text-lg">0 - 700 RPM • 50 RPM Steps</div>
      </div>

      <div className="flex items-center justify-center gap-8">
        {/* Decrease Button */}
        <button
          onClick={() => handleStepChange('down')}
          disabled={value <= min}
          aria-label="Decrease RPM"
          className="w-14 sm:w-16 h-14 sm:h-16 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-lg hover:from-red-600 hover:to-red-700 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed transition-all duration-150 active:scale-95 border border-red-400 disabled:border-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-300"
        >
          −
        </button>

        {/* Knob */}
        <div 
          ref={ref} 
          style={{ width: size, height: size }} 
          className={`relative cursor-grab active:cursor-grabbing transition-transform duration-100 ${
            isDragging ? 'scale-105' : 'scale-100'
          }`}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <defs>
              <linearGradient id="knobGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#0f172a" />
              </linearGradient>
              <linearGradient id="activeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="50%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </linearGradient>
              <linearGradient id="glowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            
            {/* Outer glow */}
            <circle 
              cx={size/2} 
              cy={size/2} 
              r={size/2 - 4} 
              fill="url(#glowGradient)"
              className="blur-[8px]"
            />
            
            {/* Main knob body */}
            <circle 
              cx={size/2} 
              cy={size/2} 
              r={size/2 - 8} 
              fill="url(#knobGradient)" 
              stroke="#334155" 
              strokeWidth={4} 
              className="shadow-2xl"
            />
            
            {/* Step markers */}
            {stepMarkers.map((marker, index) => (
              <g key={index} transform={`translate(${size/2}, ${size/2}) rotate(${marker.angle})`}>
                <rect 
                  x={-2} 
                  y={-size/2 + 16} 
                  width={4} 
                  height={18} 
                  rx={2}
                  fill={marker.isActive ? "url(#activeGradient)" : "#475569"}
                  className="transition-all duration-300"
                />
              </g>
            ))}
            
            {/* Active arc indicator */}
            <path
              d={`
                M ${size/2},${size/2}
                L ${size/2 + (size/2 - 20) * Math.cos((-135 * Math.PI) / 180)}, ${size/2 + (size/2 - 20) * Math.sin((-135 * Math.PI) / 180)}
                A ${size/2 - 20} ${size/2 - 20} 0 ${angle + 135 > 180 ? 1 : 0} 1 
                ${size/2 + (size/2 - 20) * Math.cos((angle * Math.PI) / 180)}, ${size/2 + (size/2 - 20) * Math.sin((angle * Math.PI) / 180)}
                Z
              `}
              fill="url(#activeGradient)"
              fillOpacity="0.15"
              stroke="url(#activeGradient)"
              strokeWidth="2"
              strokeOpacity="0.6"
            />
            
            {/* Knob pointer */}
            <g transform={`translate(${size/2}, ${size/2}) rotate(${angle})`}>
              <rect 
                x={-4} 
                y={-half + 30} 
                width={8} 
                height={pointerHeight} 
                rx={4} 
                fill="url(#activeGradient)"
                className="shadow-lg transition-all duration-200"
              />
              <circle 
                cx={0} 
                cy={-half + 40} 
                r={6} 
                fill="#f8fafc"
                className="shadow-lg drop-shadow-lg"
              />
            </g>
            
            {/* Center dot */}
            <circle 
              cx={size/2} 
              cy={size/2} 
              r={12} 
              fill="#1e293b" 
              stroke="url(#activeGradient)" 
              strokeWidth={3} 
              className="shadow-lg"
            />
            
            {/* RPM labels at key positions */}
            <g className="text-slate-300 font-semibold">
              <text x={size/2} y={30} textAnchor="middle" fontSize="14" fill="currentColor">0</text>
              <text x={size - 25} y={size/2} textAnchor="middle" fontSize="14" fill="currentColor">350</text>
              <text x={size/2} y={size - 20} textAnchor="middle" fontSize="14" fill="currentColor">700</text>
            </g>
          </svg>
        </div>

        {/* Increase Button */}
        <button
          onClick={() => handleStepChange('up')}
          disabled={value >= max}
          aria-label="Increase RPM"
          className="w-14 sm:w-16 h-14 sm:h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-lg hover:from-green-600 hover:to-green-700 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed transition-all duration-150 active:scale-95 border border-green-400 disabled:border-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-300"
        >
          +
        </button>
      </div>

      {/* Value display */}
      <div className="mt-8 text-center">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl px-8 py-4 inline-block shadow-lg border border-blue-500">
          <span className="text-4xl font-bold text-white">{value}</span>
          <span className="text-blue-200 ml-3 text-xl">RPM</span>
        </div>
        <div className="text-slate-400 text-lg mt-4 font-medium">
          Current Step: {value / 50} / 14
        </div>
      </div>
    </div>
  )
}