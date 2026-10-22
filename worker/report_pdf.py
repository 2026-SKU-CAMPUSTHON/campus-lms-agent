"""Render an authorized report snapshot from stdin; write only PDF bytes to stdout."""
import io
import json
import math
import re
import sys
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, LongTable, TableStyle

FONT_DIR = Path(__file__).resolve().parent / 'fonts'
NAVY = colors.HexColor('#17384B')
TEAL = colors.HexColor('#07829D')
MUTED = colors.HexColor('#526D7C')
LINE = colors.HexColor('#D7E3E9')
LIGHT = colors.HexColor('#F0F6F9')
STATES = {'open': '답변 준비 중', 'awaiting_student': '학생 보완 대기', 'awaiting_professor': '교수님 답변 대기', 'resolved': '답변 완료'}
REASONS = {'unclear_after_clarification': '추가 질문 후에도 대상 불명확', 'insufficient_evidence': '강의 근거 부족', 'judgment_uncertain': 'AI 판단 불확실', 'answer_not_grounded': '답변 출처 부족'}
ROLES = {'student': '학생', 'assistant': 'AI', 'professor': '교수님'}


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=9))).strftime('%Y-%m-%d %H:%M KST')


def rate(value):
    if value is None:
        return '집계 없음'
    percent = (Decimal(str(value)) * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
    return format(percent, 'f').rstrip('0').rstrip('.') + '%'


def clock(seconds):
    total = max(0, int(seconds))
    return '%d:%02d:%02d' % (total // 3600, total // 60 % 60, total % 60) if total >= 3600 else '%02d:%02d' % (total // 60, total % 60)


def render_report(snapshot):
    pdfmetrics.registerFont(TTFont('Campus', str(FONT_DIR / 'NanumGothic-Regular.ttf')))
    pdfmetrics.registerFont(TTFont('CampusBold', str(FONT_DIR / 'NanumGothic-Bold.ttf')))
    pdfmetrics.registerFontFamily('Campus', normal='Campus', bold='CampusBold', italic='Campus', boldItalic='CampusBold')
    pdfmetrics.registerFont(TTFont('Symbols', str(FONT_DIR / 'DejaVuSans.ttf')))
    pdfmetrics.registerFontFamily('Symbols', normal='Symbols', bold='Symbols', italic='Symbols', boldItalic='Symbols')
    glyphs = pdfmetrics.getFont('Campus').face.charToGlyph
    symbol_glyphs = pdfmetrics.getFont('Symbols').face.charToGlyph
    replacements = set()

    def safe(value):
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(value)).replace('\r\n', '\n').replace('\r', '\n').replace('\t', '    ')
        result = []
        active = None
        for char in text:
            if char == '\n':
                if active == 'Symbols':
                    result.append('</font>')
                active = None
                result.append('<br/>')
                continue
            face = 'Campus' if ord(char) in glyphs else 'Symbols' if ord(char) in symbol_glyphs else None
            if active == 'Symbols' and face != 'Symbols':
                result.append('</font>')
            if face == 'Symbols' and active != 'Symbols':
                result.append('<font name="Symbols">')
            if face is None:
                replacements.add(ord(char))
                result.append('[U+%04X]' % ord(char))
            else:
                result.append(escape(char))
            active = face
        if active == 'Symbols':
            result.append('</font>')
        return ''.join(result)

    body = ParagraphStyle('body', fontName='Campus', fontSize=9.5, leading=15, textColor=NAVY, wordWrap='CJK', spaceAfter=7, alignment=TA_LEFT, splitLongWords=True)
    small = ParagraphStyle('small', parent=body, fontSize=8, leading=12, textColor=MUTED, spaceAfter=5)
    title = ParagraphStyle('title', parent=body, fontName='CampusBold', fontSize=25, leading=34, spaceAfter=14)
    heading = ParagraphStyle('heading', parent=body, fontName='CampusBold', fontSize=15, leading=23, textColor=TEAL, spaceBefore=12, spaceAfter=10, keepWithNext=True)
    label = ParagraphStyle('label', parent=body, fontName='CampusBold', fontSize=10, leading=16, spaceBefore=10, spaceAfter=6, keepWithNext=True)
    caption = ParagraphStyle('caption', parent=small, fontName='CampusBold', textColor=TEAL, keepWithNext=True)
    table_head = ParagraphStyle('table-head', parent=small, fontName='CampusBold', textColor=colors.white, spaceAfter=0)
    table_body = ParagraphStyle('table-body', parent=small, textColor=NAVY, spaceAfter=0)
    story = []

    def p(text, style=body):
        return Paragraph(safe(text), style)

    def add(text, style=body):
        story.append(p(text, style))

    def table(rows, widths):
        data = [[p(cell, table_head if i == 0 else table_body) for cell in row] for i, row in enumerate(rows)]
        t = LongTable(data, colWidths=widths, repeatRows=1, hAlign='LEFT', splitByRow=1, splitInRow=1)
        t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT]), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9), ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 9), ('LINEBELOW', (0, -1), (-1, -1), .5, LINE)]))
        story.extend([t, Spacer(1, 10)])

    def sources(items):
        for source in items:
            name = source.get('material_name') or '강의 자료'
            if source['source_type'] == 'document':
                text = '출처 | %s · %sp' % (name, source['slide_no'])
            else:
                text = '출처 | %s · %s - %s%s' % (name, clock(source['start_sec']), clock(math.ceil(source['end_sec'])), ' · YouTube' if source.get('origin') == 'youtube' else '')
            add(text, small)

    quiz, qa = snapshot['quiz'], snapshot['qa']
    total = quiz['summary']
    width = A4[0] - 80
    add('CAMPUS LEARNING ROOM', caption)
    add('주차별 수업 레포트', title)
    add(snapshot['course_title'], heading)
    add('선택 주차 | ' + (', '.join('%s주차' % w['week_no'] for w in quiz['weeks']) or '등록된 주차 없음'))
    add('생성 시각 | ' + timestamp(snapshot['generated_at']), small)
    add('01  전체 요약', heading)
    table([['퀴즈 참여율', '퀴즈 정답률', 'Q&A'], [rate(total['participation_rate']), rate(total['correct_rate']), '%s건' % qa['summary']['thread_count']], ['%s명 / 현재 수강생 %s명' % (total['participant_count'], total['eligible_student_count']), '%s개 정답 / 답안 %s개' % (total['correct_count'], total['answer_count']), '답변 완료 %s건 · 교수 대기 %s건' % (qa['summary']['resolved_count'], qa['summary']['awaiting_professor_count'])]], [width / 3] * 3)
    add('게시 퀴즈 %s개 · 게시 문항 %s개 · 제출 %s건' % (total['quiz_count'], total['question_count'], total['submission_count']), small)
    add('02  주차별 학습 현황', heading)
    rows = [['주차', '퀴즈 / 문항', '참여 학생', '참여율', '정답률', 'Q&A']]
    for week in quiz['weeks']:
        questions = next((w['thread_count'] for w in qa['weeks'] if w['week_id'] == week['week_id']), 0)
        rows.append(['%s주차\n%s' % (week['week_no'], week['title']), '%s개 / %s문항' % (week['quiz_count'], week['question_count']), '%s / %s명' % (week['participant_count'], week['eligible_student_count']), rate(week['participation_rate']), '%s\n%s / %s개' % (rate(week['correct_rate']), week['correct_count'], week['answer_count']), '%s건' % questions])
    table(rows, [width * n for n in [.22, .16, .15, .14, .20, .13]])
    add('집계 기준', label)
    for line in ['참여율: 현재 수강생 중 선택 주차의 게시 퀴즈를 한 번 이상 제출한 고유 학생 수 / 현재 수강생 수.', '정답률: 실제 제출 답안의 정답 수 / 제출 답안 수. 전체는 분자·분모 합산이며 주차별 비율의 단순 평균이 아닙니다.', '미제출은 오답으로 세지 않습니다. 게시 퀴즈가 없거나 분모가 0이면 집계 없음으로 표시합니다. 퀴즈당 제출은 1회입니다.', '현재 수강생 기준이므로 수강생 구성이 바뀌면 과거 주차 집계도 달라질 수 있습니다. Q&A는 조회 시점의 상태와 선택 주차의 전체 대화입니다.']:
        add(line, small)
    story.append(PageBreak())
    add('03  문항별 퀴즈 결과', heading)
    if not quiz['weeks']:
        add('등록된 주차가 없습니다.')
    for week in quiz['weeks']:
        add('%s주차 · %s' % (week['week_no'], week['title']), heading)
        if not week['questions']:
            add('아직 게시한 퀴즈가 없습니다.', small)
        for question in week['questions']:
            add('퀴즈 %s · %s번 | 정답률 %s (%s/%s)' % (question['quiz_no'], question['question_no'], rate(question['correct_rate']), question['correct_count'], question['answer_count']), label)
            add(question['prompt'])
            for option in question['options']:
                correct = option['option_id'] == question['correct_option_id']
                add('%s. %s%s' % (option['option_id'].upper(), option['text'], '  [정답]' if correct else ''), body)
            add('풀이', caption)
            add(question['explanation'])
            sources(question['sources'])
            story.append(Spacer(1, 7))
    story.append(PageBreak())
    add('04  Q&A 내역', heading)
    add('질문 %s건 · 답변 완료 %s건 · 교수 대기 %s건 · 응답 오류 %s건 · 추가 질문 사용 %s건' % (qa['summary']['thread_count'], qa['summary']['resolved_count'], qa['summary']['awaiting_professor_count'], qa['summary']['error_count'], qa['summary']['clarified_thread_count']), small)
    add('선택 주차의 전체 대화를 포함합니다. 화면의 Q&A 페이지 선택과 무관합니다.', small)
    if not qa['threads']:
        add('선택한 주차에 아직 질문이 없습니다.')
    for index, thread in enumerate(qa['threads'], 1):
        week = next(w for w in quiz['weeks'] if w['week_id'] == thread['week_id'])
        add('Q&A %s | %s주차 · %s' % (index, week['week_no'], thread['student_name']), label)
        add('%s · 추가 질문 %s/1회 · %s' % (STATES[thread['state']], thread['clarification_count'], timestamp(thread['created_at'])), small)
        if thread.get('handoff_reason'):
            add('교수 승격 사유 | ' + REASONS[thread['handoff_reason']], small)
        if thread.get('error'):
            add('응답 오류 | ' + thread['error']['message'], small)
        for message in thread['messages']:
            add(ROLES[message['author_role']] + (' · 추가 질문' if message['kind'] == 'clarification' else ''), caption)
            add(message['text'])
            sources(message['sources'])
        story.append(Spacer(1, 9))
    if replacements:
        add('문자 표시 안내', label)
        add('포함 글꼴에 없는 문자는 [U+코드]로 표시했습니다. 원문을 삭제하거나 이미지로 대체하지 않았습니다.', small)

    def page_frame(canvas, document):
        canvas.saveState()
        canvas.setFont('Campus', 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(40, A4[1] - 28, '캠퍼스 학습실 · 교수 수업 레포트')
        canvas.setStrokeColor(LINE)
        canvas.line(40, A4[1] - 36, A4[0] - 40, A4[1] - 36)
        canvas.line(40, 37, A4[0] - 40, 37)
        canvas.drawString(40, 23, '교수용 · 선택 주차의 저장 결과')
        canvas.drawRightString(A4[0] - 40, 23, '%s' % document.page)
        canvas.restoreState()

    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=40, rightMargin=40, topMargin=54, bottomMargin=49, title='주차별 수업 레포트', author='캠퍼스 학습실', pageCompression=1)
    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    return output.getvalue()


if __name__ == '__main__':
    try:
        snapshot = json.loads(sys.stdin.buffer.read(16 * 1024 * 1024 + 1))
        sys.stdout.buffer.write(render_report(snapshot))
    except Exception:
        sys.stderr.write('REPORT_PDF_RENDER_FAILED\n')
        sys.exit(1)
