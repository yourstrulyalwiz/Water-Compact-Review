import { useEffect, useRef, useState, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { AnchorDetail, Document, Rectangle } from '@workspace/api-client-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

interface PdfViewerProps {
  documentId: string;
  documentSha256: string;
  matchedPage: number;
  rectangles: Rectangle[];
  anchorRole: string;
}

export function PdfViewer({ documentId, documentSha256, matchedPage, rectangles, anchorRole }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [hashMismatch, setHashMismatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.5);
  const [currentPage, setCurrentPage] = useState(matchedPage || 1);

  // Load PDF
  useEffect(() => {
    let active = true;
    if (!documentId) return;

    setLoading(true);
    setError(null);
    setHashMismatch(false);

    const load = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/pdf`);
        if (!response.ok) {
          throw new Error('Failed to load PDF');
        }
        const serverHash = response.headers.get('X-Document-SHA256');
        if (serverHash && serverHash !== documentSha256) {
          setHashMismatch(true);
        }

        const arrayBuffer = await response.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        if (active) {
          setPdfDoc(pdf);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      }
    };
    load();

    return () => { active = false; };
  }, [documentId, documentSha256]);

  // Navigate to matchedPage when it changes
  useEffect(() => {
    if (matchedPage) {
      setCurrentPage(matchedPage);
    }
  }, [matchedPage]);

  // Render Page
  useEffect(() => {
    let active = true;
    let renderTask: pdfjsLib.RenderTask | null = null;

    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (!active) return;
        
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;
        
        // Output scale for high-DPI displays
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + "px";
        canvas.style.height =  Math.floor(viewport.height) + "px";

        const transform = outputScale !== 1 
          ? [outputScale, 0, 0, outputScale, 0, 0] 
          : undefined;

        renderTask = page.render({
          canvasContext: context,
          transform: transform,
          viewport: viewport,
        });

        await renderTask.promise;
      } catch (err: any) {
        if (err.name === 'RenderingCancelledException') return;
        console.error('Render error:', err);
      }
    };

    renderPage();

    return () => {
      active = false;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale]);

  // Rectangle Highlights logic
  const highlightColor = useMemo(() => {
    switch (anchorRole) {
      case 'Primary Evidence': return 'rgba(245, 158, 11, 0.3)'; // amber
      case 'Context': return 'rgba(59, 130, 246, 0.25)'; // blue
      case 'Aspiration': return 'rgba(168, 85, 247, 0.3)'; // purple
      case 'Explicit Mechanism': return 'rgba(34, 197, 94, 0.25)'; // green
      case 'Duplicate/Sub-action Evidence': return 'rgba(249, 115, 22, 0.25)'; // orange
      case 'Exclusion Evidence': return 'rgba(239, 68, 68, 0.25)'; // red
      default: return 'rgba(245, 158, 11, 0.3)';
    }
  }, [anchorRole]);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [pdfDoc, currentPage, scale, loading]); // Need to re-bind when canvas re-renders

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden relative">
      {/* Toolbar */}
      <div className="flex-none flex items-center justify-between p-2 bg-white border-b border-border shadow-sm z-10">
        <div className="flex items-center gap-2">
          <button 
            className="p-1 px-2 border rounded text-xs bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            disabled={!pdfDoc || currentPage <= 1}
            onClick={() => setCurrentPage(c => c - 1)}
          >
            Prev
          </button>
          <span className="text-xs font-medium font-mono">
            Page {currentPage} / {pdfDoc?.numPages || '?'}
          </span>
          <button 
            className="p-1 px-2 border rounded text-xs bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            disabled={!pdfDoc || currentPage >= (pdfDoc?.numPages || 1)}
            onClick={() => setCurrentPage(c => c + 1)}
          >
            Next
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button 
            className="p-1 px-2 border rounded text-xs bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            disabled={!pdfDoc}
            onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
          >
            Zoom Out
          </button>
          <span className="text-xs font-mono">{Math.round(scale * 100)}%</span>
          <button 
            className="p-1 px-2 border rounded text-xs bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            disabled={!pdfDoc}
            onClick={() => setScale(s => Math.min(4, s + 0.25))}
          >
            Zoom In
          </button>
        </div>
      </div>

      {hashMismatch && (
        <div className="bg-amber-100 text-amber-900 text-xs p-2 text-center border-b border-amber-200">
          Document version mismatch — highlights disabled
        </div>
      )}

      {/* PDF Container */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex justify-center bg-slate-200/50"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-slate-500">Loading document...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-500 text-sm">
            {error}
          </div>
        ) : (
          <div className="relative shadow-lg bg-white" style={{ width: 'max-content', height: 'max-content' }}>
            <canvas ref={canvasRef} className="block max-w-none" />
            
            {/* Highlights Overlay */}
            {!hashMismatch && currentPage === matchedPage && canvasSize.width > 0 && rectangles?.map((rect) => {
              const left = rect.x0_normalized * canvasSize.width;
              const top = rect.y0_normalized * canvasSize.height;
              const width = (rect.x1_normalized - rect.x0_normalized) * canvasSize.width;
              const height = (rect.y1_normalized - rect.y0_normalized) * canvasSize.height;

              return (
                <div 
                  key={rect.rectangle_id}
                  className="absolute mix-blend-multiply pointer-events-none"
                  style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    height: `${height}px`,
                    backgroundColor: highlightColor,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
