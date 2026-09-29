import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { Rectangle } from '@workspace/api-client-react';

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
  pageRotation?: number;
}

type Verification = 'loading' | 'verified' | 'failed';

export function PdfViewer({ documentId, documentSha256, matchedPage, rectangles, anchorRole, pageRotation = 0 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [verification, setVerification] = useState<Verification>('loading');
  const [verificationMessage, setVerificationMessage] = useState('Verifying source document…');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.5);
  const [currentPage, setCurrentPage] = useState(matchedPage || 1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    // A document transition must not leave the previous source or its overlays visible.
    pdfRef.current?.destroy();
    pdfRef.current = null;
    setPdfDoc(null);
    setCurrentPage(matchedPage || 1);
    setCanvasSize({ width: 0, height: 0 });
    setVerification('loading');
    setVerificationMessage('Verifying source document…');
    setError(null);
    setLoading(true);
    if (canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    const load = async () => {
      try {
        if (!/^[a-f0-9]{64}$/i.test(documentSha256 || '')) {
          throw new Error('Expected SHA-256 is missing or invalid. Source version cannot be verified; highlights are disabled.');
        }
        const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/pdf`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Unable to fetch source PDF (${response.status} ${response.statusText}).`);
        const bytes = await response.arrayBuffer();
        if (!globalThis.crypto?.subtle) throw new Error('This browser cannot verify SHA-256. Source highlights are disabled.');
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        const actualHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actualHash.toLowerCase() !== documentSha256.toLowerCase()) {
          throw new Error(`Source PDF SHA-256 mismatch (received ${actualHash}). Highlights are disabled.`);
        }
        if (!active) return;
        setVerification('verified');
        setVerificationMessage('PDF bytes match the recorded SHA-256.');
        // PDF.js may transfer/detach its input buffer, so pass it a copy after hashing.
        loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
        const pdf = await loadingTask.promise;
        if (!active) {
          await pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPdfDoc(pdf);
        setLoading(false);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        const message = err instanceof Error ? err.message : 'Unable to verify source PDF.';
        setVerification('failed');
        setVerificationMessage(message);
        setError(message);
        setLoading(false);
        if (loadingTask) void loadingTask.destroy();
      }
    };
    void load();

    return () => {
      active = false;
      controller.abort();
      if (pdfRef.current) {
        void pdfRef.current.destroy();
        pdfRef.current = null;
      } else if (loadingTask) void loadingTask.destroy();
    };
  }, [documentId, documentSha256, matchedPage]);

  useEffect(() => {
    if (matchedPage) setCurrentPage(matchedPage);
  }, [matchedPage]);

  useEffect(() => {
    let active = true;
    let renderTask: pdfjsLib.RenderTask | null = null;
    const renderPage = async () => {
      const canvas = canvasRef.current;
      if (!pdfDoc || !canvas || verification !== 'verified') return;
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (!active) return;
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext('2d');
        if (!context) return;
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setCanvasSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
        renderTask = page.render({
          canvasContext: context,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          viewport,
        });
        await renderTask.promise;
      } catch (err) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') return;
        if (active) setError(err instanceof Error ? err.message : 'Unable to render PDF page.');
      }
    };
    void renderPage();
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [pdfDoc, currentPage, scale, verification]);

  const highlightColor = useMemo(() => {
    switch (anchorRole) {
      case 'Canonical Action': return 'rgba(245, 158, 11, 0.3)';
      case 'Canonical Continuation': return 'rgba(59, 130, 246, 0.25)';
      case 'Context': return 'rgba(59, 130, 246, 0.25)';
      default: return 'rgba(245, 158, 11, 0.3)';
    }
  }, [anchorRole]);

  return <div className="flex flex-col h-full bg-slate-100 overflow-hidden relative">
    <div className="flex-none flex items-center justify-between p-2 bg-white border-b shadow-sm z-10">
      <div className="flex items-center gap-2">
        <button className="p-1 px-2 border rounded text-xs bg-slate-50 disabled:opacity-50" disabled={!pdfDoc || currentPage <= 1} onClick={() => setCurrentPage(c => c - 1)}>Prev</button>
        <span className="text-xs font-medium font-mono">Page {currentPage} / {pdfDoc?.numPages || '?'}</span>
        <button className="p-1 px-2 border rounded text-xs bg-slate-50 disabled:opacity-50" disabled={!pdfDoc || currentPage >= (pdfDoc?.numPages || 1)} onClick={() => setCurrentPage(c => c + 1)}>Next</button>
      </div>
      <div className="flex items-center gap-2">
        <button className="p-1 px-2 border rounded text-xs bg-slate-50 disabled:opacity-50" disabled={!pdfDoc} onClick={() => setScale(s => Math.max(0.5, s - 0.25))}>Zoom Out</button>
        <span className="text-xs font-mono">{Math.round(scale * 100)}%</span>
        <button className="p-1 px-2 border rounded text-xs bg-slate-50 disabled:opacity-50" disabled={!pdfDoc} onClick={() => setScale(s => Math.min(4, s + 0.25))}>Zoom In</button>
      </div>
    </div>
    <div className={`text-[10px] px-2 py-1 text-center border-b ${verification === 'verified' && pageRotation % 360 === 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : verification === 'failed' || pageRotation % 360 !== 0 ? 'bg-amber-100 text-amber-900 border-amber-200' : 'bg-slate-100 text-slate-600'}`} role="status">{pageRotation % 360 !== 0 && verification === 'verified' ? `PDF bytes verified. Highlights disabled: page rotation ${pageRotation}° is not supported by this evidence overlay.` : verificationMessage}</div>
    <div className="flex-1 overflow-auto p-4 flex justify-center bg-slate-200/50">
      {loading ? <div className="flex items-center justify-center h-full"><span className="text-sm text-slate-500">Loading and verifying document…</span></div> : error ? <div className="flex items-center justify-center h-full text-amber-800 text-xs text-center max-w-md">{error}</div> : <div className="relative shadow-lg bg-white" style={{ width: 'max-content', height: 'max-content' }}>
        <canvas ref={canvasRef} className="block max-w-none" />
        {verification === 'verified' && pageRotation % 360 === 0 && currentPage === matchedPage && canvasSize.width > 0 && rectangles?.map(rect => {
          const raw = rect as Rectangle & Record<string, any>;
          const x0 = Number(raw.x0_normalized ?? raw.X0_Normalized);
          const y0 = Number(raw.y0_normalized ?? raw.Y0_Normalized);
          const x1 = Number(raw.x1_normalized ?? raw.X1_Normalized);
          const y1 = Number(raw.y1_normalized ?? raw.Y1_Normalized);
          const left = x0 * canvasSize.width;
          const top = y0 * canvasSize.height;
          const width = (x1 - x0) * canvasSize.width;
          const height = (y1 - y0) * canvasSize.height;
          return <div key={raw.rectangle_id ?? raw.Rectangle_ID} className="absolute mix-blend-multiply pointer-events-none" style={{ left, top, width, height, backgroundColor: highlightColor }} />;
        })}
      </div>}
    </div>
  </div>;
}