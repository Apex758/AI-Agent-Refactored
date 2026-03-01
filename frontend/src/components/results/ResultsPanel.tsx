'use client'

import { useChatStore } from '@/store/chatStore'

export function ResultsPanel() {
  const { results, error } = useChatStore()

  if (results.length === 0 && !error) {
    return (
      <div className="w-80 bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Results</h2>
        <div className="flex items-center justify-center h-64 text-gray-400">
          <p>Tool results will appear here...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-80 bg-white rounded-lg border border-gray-200 p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Results</h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {results.map((result, index) => (
        <div key={index} className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">Tool Result</span>
            <span className="text-xs text-gray-400">#{index + 1}</span>
          </div>
          
          {result.error ? (
            <p className="text-red-600 text-sm">{result.error}</p>
          ) : (
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all">
              {typeof result.result === 'string' 
                ? result.result 
                : JSON.stringify(result.result, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
