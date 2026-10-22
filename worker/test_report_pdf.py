"""PDF content/layout regression checks using synthetic contract fixtures only."""
import copy
import io
import json
import re
import unittest
from pathlib import Path
from pypdf import PdfReader
from report_pdf import render_report, rate

ROOT = Path(__file__).resolve().parents[1]


def snapshot():
    base = ROOT / 'docs/contracts/examples'
    return {'course_title': '한국어 강의 <텍스트> & PDF', 'generated_at': '2026-10-21T23:30:00Z', 'quiz': json.loads((base / 'quiz-report.json').read_text()), 'qa': json.loads((base / 'qa-report.json').read_text())}


def read(value):
    reader = PdfReader(io.BytesIO(render_report(value)))
    return reader, '\n'.join(page.extract_text() for page in reader.pages)


class PDFReportTests(unittest.TestCase):
    def test_korean_text_embedded_fonts_escaped_markup_and_kst(self):
        value = snapshot()
        value['quiz']['weeks'][0]['questions'][0]['prompt'] = '<img src="file:///not-read"> & 한국어 질문 🫠'
        reader, text = read(value)
        self.assertIn('한국어 강의 <텍스트> & PDF', text)
        self.assertIn('<img src="file:///not-read"> & 한국어 질문 [U+1FAE0]', text)
        self.assertIn('2026-10-22 08:30 KST', text)
        self.assertIn('문자 표시 안내', text)
        value['quiz']['weeks'][0]['questions'][0]['prompt'] = '수식 sin(nπx/L) · α ≤ β ∑'
        _, symbols = read(value)
        self.assertIn('sin(nπx/L)', symbols)
        self.assertIn('α ≤ β ∑', symbols)
        self.assertTrue(any('/FontFile2' in font.get_object().get('/FontDescriptor', {}) for page in reader.pages for font in page['/Resources']['/Font'].values()))
        self.assertFalse(any('/Annots' in page for page in reader.pages))

    def test_long_korean_paragraphs_wrap_across_pages_without_losing_end(self):
        value = snapshot()
        question = value['quiz']['weeks'][0]['questions'][0]
        question['prompt'] = '긴 문제 ' + '연속한글문자' * 350
        question['explanation'] = '장문해설시작 ' + '한국어 긴 풀이를 검토합니다. ' * 250 + ' 장문해설끝'
        for option in question['options']:
            option['text'] = option['option_id'] + ' 긴 보기 ' * 100
        thread = value['qa']['threads'][0]
        thread['messages'][0]['text'] = '긴대화시작 ' + '설명할 내용을 확인합니다. ' * 250 + ' 긴대화끝'
        thread['student_name'] = '학생이름' * 100
        reader, text = read(value)
        self.assertGreater(len(reader.pages), 5)
        for marker in ['장문해설시작', '장문해설끝', '긴대화시작', '긴대화끝']:
            self.assertIn(marker, re.sub(r'\s+', '', text))
        for index, page in enumerate(reader.pages, 1):
            self.assertIn('교수용', page.extract_text())
            self.assertIn(str(index), page.extract_text())

    def test_all_threads_and_messages_are_included(self):
        value = snapshot()
        original = value['qa']['threads'][0]
        value['qa']['threads'] = []
        for index in range(106):
            thread = copy.deepcopy(original)
            thread['messages'][0]['text'] = '전체질문_%03d' % index
            value['qa']['threads'].append(thread)
        _, text = read(value)
        for index in range(106):
            self.assertIn('전체질문_%03d' % index, text)

    def test_null_and_zero_are_distinct_and_empty_report_is_valid(self):
        value = snapshot()
        self.assertEqual(rate(.0225), '2.3%')
        self.assertEqual(rate(1), '100%')
        value['quiz']['summary']['correct_rate'] = 0
        value['quiz']['summary']['participation_rate'] = None
        value['qa']['threads'] = []
        _, text = read(value)
        self.assertIn('0%', text)
        self.assertIn('집계 없음', text)
        self.assertIn('선택한 주차에 아직 질문이 없습니다.', text)


if __name__ == '__main__':
    unittest.main()
