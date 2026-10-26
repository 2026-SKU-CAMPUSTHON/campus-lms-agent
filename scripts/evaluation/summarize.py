"""Aggregate one completed live run and explicit provisional review. No model calls."""
import collections
import json
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / '.data/evaluation-runs' / sys.argv[1]
assert RUN.parent == ROOT / '.data/evaluation-runs'
load = lambda p: json.loads(p.read_text())
meta = load(RUN / 'metadata.json')
assert (RUN / 'execution-completed.json').exists(), 'Incomplete run: do not publish a full-set result'
grades = load(Path(sys.argv[2]))
assert grades['run_id'] == meta['run_id']
assert grades['review_type'] == 'AI provisional; no independent human approval'
gold = {r['case_id']:r for r in map(json.loads, (ROOT/'evaluation/v1/qa-final-reviewer.jsonl').read_text().splitlines())}
assert len(gold) == 30
records = [load(p) for p in sorted((RUN/'final').glob('*.json'))]
assert len(records) == 60
assert len({(r['case_id'],r['arm']) for r in records}) == 60
assert set(grades['qa']) == {r['case_id']+'_'+r['arm'] for r in records}
quiz = [load(RUN/'quiz'/f'QB{i}.json') for i in range(1,4)]
assert set(grades['quiz']) == {f'G{i}-{j:02}' for i in range(1,4) for j in range(1,11)}
calls = load(RUN/'call-index.json')
assert len({c['call'] for c in calls}) == len(calls)
qa_rows = []
for r in records:
    key = r['case_id']+'_'+r['arm']
    g = grades['qa'][key]
    has_answer = any(m['author_role']=='assistant' and m['kind']=='answer' for m in r['thread']['messages'])
    assert (g['correctness'] is not None) == has_answer
    assert g['correctness'] in (None,0,1,2)
    for k in ('grounded','citation_correct'): assert g[k] in ((0,1) if has_answer else (None,))
    assert g['unsupported_answer'] in (0,1)
    assert g['retrieval_hit'] in (None,0,1)
    assert g['notes']
    row={**r,**g,'category':gold[r['case_id']]['category'],'expected_path':gold[r['case_id']]['expected_path'],'has_answer':has_answer,'route_correct':int(r['status']=='completed' and r['actual_path']==gold[r['case_id']]['expected_path'])}
    qa_rows.append(row)

def usage(subset):
    result={}
    for provider in ('claude','jev'):
        rows=[c for c in subset if c['provider']==provider]
        result[provider]={'calls':len(rows),'http_errors':sum(c.get('http_status')!=200 for c in rows),'input_tokens':sum((c['usage'] or {}).get('input_tokens',0) for c in rows),'output_tokens':sum((c['usage'] or {}).get('output_tokens',0) for c in rows),'usage_missing_calls':sum(c['usage'] is None for c in rows)}
    return result

arms={}
for arm in ('direct_answer','jev_gate'):
    rows=[r for r in qa_rows if r['arm']==arm]
    assert len(rows)==30
    answerable=[r for r in rows if r['category']=='answerable']
    ambiguous=[r for r in rows if r['category']=='ambiguous']
    answered=[r for r in rows if r['has_answer']]
    unsafe_set=[r for r in rows if r['category'] in ('ambiguous','insufficient')]
    labels={r['case_id'] for r in rows}
    subset=[c for c in calls if c['label'].startswith('final/') and c['label'].split('/')[1] in labels and c['label'].endswith('/'+arm)]
    arms[arm]={
        'attempted':len(rows),'completed':sum(r['status']=='completed' for r in rows),'api_or_processing_failures':sum(r['status']=='failed' for r in rows),
        'route_correct':sum(r['route_correct'] for r in rows),'route_accuracy':sum(r['route_correct'] for r in rows)/len(rows),
        'category_routes':{cat:{'correct':sum(r['route_correct'] for r in rows if r['category']==cat),'total':sum(r['category']==cat for r in rows)} for cat in ('answerable','ambiguous','insufficient')},
        'answered':len(answered),'answer_content_full_correct':sum(r['correctness']==2 for r in answered),
        'ambiguous_initial_answers':sum(r['actual_path']=='answer' for r in ambiguous),
        'clarify_then_answer':sum(r['actual_path']=='clarify>answer' for r in rows),
        'answer_content_full_correct_rate':sum(r['correctness']==2 for r in answered)/len(answered) if answered else None,
        'initial_answerable_success':sum(r['correctness']==2 and r['grounded']==1 and r['citation_correct']==1 for r in answerable),
        'initial_answerable_total':len(answerable),'unnecessary_handoff_initial_answerable':sum(r['actual_path'].endswith('handoff') for r in answerable),
        'unsupported_answer_in_ambiguous_or_insufficient':sum(r['unsupported_answer'] for r in unsafe_set),'unsafe_set_total':len(unsafe_set),
        'clarification_limit_violations':sum(r['clarification_count']>1 for r in rows),
        'mean_latency_sec':statistics.mean(r['latency_ms']/1000 for r in rows),'median_latency_sec':statistics.median(r['latency_ms']/1000 for r in rows),'max_latency_sec':max(r['latency_ms']/1000 for r in rows),
        'route_counts':dict(collections.Counter(r['actual_path'] for r in rows)),
        'confusion':dict(collections.Counter(r['expected_path']+' => '+r['actual_path'] for r in rows)),
        'api_usage':usage(subset),'cost_usd':None,
    }

pairs=[]
for cid in gold:
    a=next(r for r in qa_rows if r['case_id']==cid and r['arm']=='direct_answer')
    b=next(r for r in qa_rows if r['case_id']==cid and r['arm']=='jev_gate')
    assert a['observations'][0]['passages_sha256']==b['observations'][0]['passages_sha256'], 'Paired retrieval differs'
    assert a['observations'][0]['input']['messages'][0]['text']==b['observations'][0]['input']['messages'][0]['text']
    pairs.append({'case_id':cid,'direct_route_correct':a['route_correct'],'jev_route_correct':b['route_correct']})

quiz_rows=[]
for i,q in enumerate(quiz,1):
    questions=(q.get('draft') or {}).get('questions',[])
    for j in range(10):
        slot=f'G{i}-{j+1:02}';g=grades['quiz'][slot]
        for key in ('correct','explanation','options','in_scope','duplicate'): assert g[key] in (0,1)
        assert g['notes']
        passed=int(q['status']=='completed' and g['correct']==g['explanation']==g['options']==g['in_scope']==1 and g['duplicate']==0 and g['disposition']=='그대로 사용')
        quiz_rows.append({'slot':slot,'scope_id':q['scope_id'],'status':q['status'],'question':questions[j] if j<len(questions) else None,**g,'unchanged_pass':passed})

summary={
    'run_id':meta['run_id'],'dataset_version':meta['dataset_version'],'code_commit':meta['code_commit'],'runner_sha256':meta['runner_sha256'],
    'model':meta['model'],'jev_model':meta['jev_model'],'minimum':meta['minimum'],
    'review_type':grades['review_type'],'human_review_pending':True,'video_audiovisual_review_pending':True,
    'qa':arms,'paired_initial_retrieval_identical':len(pairs),
    'paired_route_outcomes':dict(collections.Counter(f"direct_{p['direct_route_correct']}_jev_{p['jev_route_correct']}" for p in pairs)),
    'quiz':{'requested':30,'generated':sum(len((q.get('draft') or {}).get('questions',[])) for q in quiz),'unchanged_pass':sum(q['unchanged_pass'] for q in quiz_rows),'by_scope':{q['scope_id']:{'generated':len((q.get('draft') or {}).get('questions',[])),'unchanged_pass':sum(r['unchanged_pass'] for r in quiz_rows if r['scope_id']==q['scope_id']),'generation_sec':q['latency_ms']/1000} for q in quiz},'answer_position_counts':dict(collections.Counter(r['question']['correct_option_id'] for r in quiz_rows if r['question']))},
    'usage_all_including_dev_and_quiz':usage(calls),'cost_usd':None,
    'functional_cases_executed':False,'human_time_study_executed':False,
}
(RUN/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
(RUN/'scored-records.json').write_text(json.dumps({'summary':summary,'qa':qa_rows,'quiz':quiz_rows},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
