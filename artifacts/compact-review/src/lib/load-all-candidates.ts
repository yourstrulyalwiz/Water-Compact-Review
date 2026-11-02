/** Load the whole dataset before exposing it to filters; never accept partial pages. */
export async function loadAllCandidates(
  read: (url: string) => Promise<any>,
): Promise<any> {
  const pageSize = 500;
  const first = await read(`/api/candidates?page=1&limit=${pageSize}`);
  if (Array.isArray(first)) return first; // Legacy API, already unpaginated.
  const rows = first?.candidates ?? first?.items;
  if (!Array.isArray(rows) || !Number.isSafeInteger(first.total) || first.total < 0 ||
      !first.dataset_id || first.page !== 1 || first.limit !== pageSize) {
    throw new Error('Invalid candidate response. Please reload to retry.');
  }
  const all = [...rows];
  if (rows.length !== Math.min(pageSize, first.total)) throw new Error('Incomplete first candidate page.');
  for (let page = 2; all.length < first.total; page++) {
    const response = await read(`/api/candidates?page=${page}&limit=${pageSize}`);
    const next = response?.candidates ?? response?.items;
    if (response?.dataset_id !== first.dataset_id || response?.total !== first.total ||
        response?.page !== page || response?.limit !== pageSize ||
        !Array.isArray(next) || next.length !== Math.min(pageSize, first.total - all.length)) {
      throw new Error('Candidate data changed or a page is incomplete. Please reload to retry.');
    }
    all.push(...next);
  }
  const ids = all.map(row => row?.candidate_id ?? row?.Candidate_ID ?? row?.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== first.total) {
    throw new Error('Duplicate or missing candidates. Please reload to retry.');
  }
  return { ...first, candidates: all };
}
