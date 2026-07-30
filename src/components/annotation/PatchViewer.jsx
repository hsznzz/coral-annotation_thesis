import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

/**
 * Zoomable/pannable display of the current patch (react-zoom-pan-pinch),
 * with a small metadata panel and status badge.
 */
function PatchViewer({ imageUrl, index, total, status, filename, metadata }) {
  const metadataEntries = Object.entries(metadata || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );

  return (
    <div className="flex flex-col gap-3 items-center w-full">
      <div className="w-full flex items-center justify-between text-xs sm:text-sm text-slate-400">
        <span className="flex items-center gap-2">
          Current patch
          {status === 'annotated' && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-medium">
              already annotated
            </span>
          )}
        </span>
        {index != null && total != null && (
          <span>
            Patch <span className="text-emerald-400 font-medium">{index}</span> of {total}
          </span>
        )}
      </div>

      <div className="w-full max-w-xl aspect-square rounded-xl overflow-hidden border border-slate-700 bg-slate-900 flex items-center justify-center relative">
        {imageUrl ? (
          <TransformWrapper minScale={1} maxScale={8} centerOnInit doubleClick={{ mode: 'zoomIn' }}>
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                  <img
                    src={imageUrl}
                    alt={filename || 'Coral patch'}
                    className="h-full w-full object-cover select-none"
                    draggable={false}
                  />
                </TransformComponent>
                <div className="absolute bottom-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => zoomOut()}
                    className="w-8 h-8 rounded-md bg-slate-900/80 border border-slate-600 text-slate-200 hover:bg-slate-800"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => resetTransform()}
                    className="px-2 h-8 rounded-md bg-slate-900/80 border border-slate-600 text-slate-200 hover:bg-slate-800 text-xs"
                    aria-label="Reset zoom"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomIn()}
                    className="w-8 h-8 rounded-md bg-slate-900/80 border border-slate-600 text-slate-200 hover:bg-slate-800"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </div>
              </>
            )}
          </TransformWrapper>
        ) : (
          <p className="text-sm text-slate-500">No patch loaded</p>
        )}
      </div>

      {metadataEntries.length > 0 && (
        <div className="w-full max-w-xl bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3 text-xs sm:text-sm text-slate-300">
          <p className="text-slate-400 mb-1 font-medium">Image metadata {filename ? `— ${filename}` : ''}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {metadataEntries.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-slate-500 capitalize">{key.replace(/_/g, ' ')}</dt>
                <dd className="text-slate-200 text-right truncate">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export default PatchViewer;
