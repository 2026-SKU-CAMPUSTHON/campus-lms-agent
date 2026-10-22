"""초기 계약과 공개 응답 예제의 구조를 검사한다. 앱 통합 테스트는 별도다."""
import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate_spec
from openapi_schema_validator import OAS30Validator

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / 'docs/contracts'
def read(name):
    return json.loads((CONTRACTS / name).read_text())
api = read('openapi.yaml')
validate_spec(api)
worker = read('worker.schema.json')
Draft202012Validator.check_schema(worker)
validator = Draft202012Validator(worker, format_checker=FormatChecker())
for path in (CONTRACTS / 'examples').glob('worker-*.json'):
    validator.validate(json.loads(path.read_text()))
request = read('examples/worker-request.json')
result = read('examples/worker-result.json')
for segment in result['segments']:
    assert request['page_range']['start'] <= segment['slide_no'] <= request['page_range']['end']
    assert segment['start_sec'] is None and segment['end_sec'] is None
for segment in read('examples/worker-audio-result.json')['segments']:
    assert segment['slide_no'] is None and 0 <= segment['start_sec'] <= segment['end_sec']
# 실패 상태와 성공 결과가 섞인 응답을 거부하는지 확인한다.
bad = {**result, 'status': 'failed'}
assert list(validator.iter_errors(bad)), 'failed result must contain error and no segments'
for schema_name, name in [('PublicQuiz', 'public-quiz.json'), ('AttemptResult', 'attempt-result.json'), ('Thread', 'qa-clarification.json'), ('Thread', 'qa-handoff.json'), ('QuizReport', 'quiz-report.json'), ('QAReport', 'qa-report.json'), ('Thread', 'qa-transcript.json'), ('Transcript', 'transcript.json'), ('Thread', 'qa-youtube.json'), ('YouTubeImportRequest', 'youtube-request.json'), ('QuizDraft', 'youtube-quiz-draft.json'), ('AttemptResult', 'youtube-attempt-result.json'), ('EditDraftQuestionRequest', 'edit-draft-question.json')]:
    schema = {'$ref': '#/components/schemas/' + schema_name, 'components': api['components']}
    OAS30Validator(schema, format_checker=FormatChecker()).validate(read('examples/' + name))
def check_public(value):
    if isinstance(value, dict):
        assert not {'correct_option_id', 'explanation', 'is_correct'} & value.keys(), 'answer leaked before submit'
        for child in value.values(): check_public(child)
    elif isinstance(value, list):
        for child in value: check_public(child)
check_public(read('examples/public-quiz.json'))
assert api['components']['schemas']['PublicQuestion']['additionalProperties'] is False
svg = ROOT / 'docs/assets/architecture.svg'
ElementTree.parse(svg)
source = json.loads((svg.parent / 'architecture.source.json').read_text())
assert source['frame_id'] == '560:2'
assert hashlib.sha256(svg.read_bytes()).hexdigest() == source['sha256']
assert 'Jev' in svg.read_text()
assert read('examples/qa-handoff.json')['clarification_count'] == 1
print('PASS: OpenAPI, Worker examples, public quiz, Figma SVG provenance')

fonts = ROOT / 'worker/fonts'
for manifest in ['source.json', 'dejavu-source.json']:
    for entry in json.loads((fonts / manifest).read_text())['files']:
        assert hashlib.sha256((fonts / entry['file']).read_bytes()).hexdigest() == entry['sha256'], 'PDF font provenance mismatch'
assert 'application/pdf' in api['paths']['/courses/{course_id}/reports/pdf']['get']['responses']['200']['content']
print('PASS: PDF download contract and font provenance')
