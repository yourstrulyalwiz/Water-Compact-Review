// Explicit insert allowlist. Package-supplied identifiers never become SQL.
export const columns = {
  documents: 'document_id,country_code,country,document_title,source_language,document_version,source_file_name,source_library_id,official_source_url,repository_source,sha256,pdf_page_count,asset_path,page_numbering_basis,coordinate_system,extraction_limitations,raw_row',
  analysis_runs: 'analysis_run_id,methodology_version,schema_version,analysis_date,baseline,unit_of_analysis,coverage,status,raw_row',
  candidate_baselines: 'candidate_id,country,source_language,source_reference,compact_form,evidence_passage_original_language,evidence_passage_english_translation,reform_action_text_original_language,reform_action_text_english_translation,candidate_stream,c1_explicit_commitment,c2_discrete_actionable_mechanism,c3_system_change,c4_not_merely_implementation,c5_distinct_reform_action,c6_trackable_monitorable,six_criteria_pass,llm_decision_rationale,cluster_id,cluster_role,parent_reform_action_id,primary_pillar,primary_scalable_solution,additional_scalable_solutions,primary_tier1_reform_domain,tier2_reform_category,secondary_reform_domain_tags,lead_institution_actor,water_financing_relevance,temporal_status,monitoring_completion_criterion,global_review_decision,regional_confirmation_decision,final_status,count_in_final_reform_total,reform_action_statement_english,document_id,analysis_run_id,analysis_version_id,global_review_comment,regional_comment,review_resolution,country_code,source_row',
  evidence: 'evidence_id,document_id,pdf_page,printed_page_label,section_or_table,quote_original_language,quote_english_translation,text_prefix,text_suffix,page_char_start,page_char_end,quote_sha256,location_status,match_method,extraction_method,analysis_run_id,raw_row',
  candidate_evidence: 'candidate_id,evidence_id,evidence_role,relationship_note,analysis_run_id,raw_row',
  evidence_rectangles: 'rectangle_id,evidence_id,pdf_page,x0,y0,x1,y1,x0_normalized,y0_normalized,x1_normalized,y1_normalized,page_width_points,page_height_points,coordinate_origin,coordinate_unit,page_rotation,raw_row',
  relationships: 'source_candidate_id,target_candidate_id,relationship_type,rationale,relationship_id,status,raw_row',
  id_crosswalk: 'scan_id,candidate_id,first_recorded_pdf_page,disposition,reconciliation_note,raw_row',
  scan_log: 'document_id,pdf_page,review_method,screening_note,linked_candidate_ids,scan_status,raw_row',
  qa_checks: 'check_name,candidate_id,status,detail,raw_row',
} as const;
export type Table = keyof typeof columns;
export type Row = Record<string, any>;
export const tables = Object.keys(columns) as Table[];
export const assessmentFields = 'candidate_stream,c1_explicit_commitment,c2_discrete_actionable_mechanism,c3_system_change,c4_not_merely_implementation,c5_distinct_reform_action,c6_trackable_monitorable,llm_decision_rationale,cluster_role,primary_pillar,primary_scalable_solution,additional_scalable_solutions,primary_tier1_reform_domain,tier2_reform_category,secondary_reform_domain_tags,lead_institution_actor,water_financing_relevance,temporal_status,monitoring_completion_criterion,reform_action_statement_english'.split(',');
export function initialAssessment(row: Row): Row {
  return { candidate_id: row.candidate_id, assessment_revision: 1,
    ...Object.fromEntries(assessmentFields.map(key => [key, row[key]])),
    originating_analysis_version_id: row.analysis_version_id,
    change_reason: 'Imported baseline', created_by: null };
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
