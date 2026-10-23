"""PPTX/PDF 문서를 페이지별 텍스트로 정규화한다. OCR은 포함하지 않는다."""
import json
from pathlib import Path
import sys
from pptx_extract import extract as extract_pptx

def extract(path, start, end):
    if Path(path).suffix.lower() == '.pptx':
        return extract_pptx(path, start, end)
    if Path(path).suffix.lower() != '.pdf':
        raise ValueError('PDF 또는 PPTX 파일을 선택해 주세요.')
    from pypdf import PdfReader
    if not 1 <= start <= end:
        raise ValueError('시작과 끝 페이지를 확인해 주세요.')
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError('암호화된 PDF는 암호를 해제한 뒤 올려 주세요.')
    total = len(reader.pages)
    if total > 500 or end > total:
        raise ValueError('선택 범위가 실제 페이지 수를 넘거나 문서가 500페이지를 넘습니다.')
    slides = [{'slide_no': i + 1, 'text': reader.pages[i].extract_text() or ''}
              for i in range(start - 1, end)]
    if not any(s['text'].strip() for s in slides):
        raise ValueError('선택 범위에서 텍스트를 찾지 못했습니다. 스캔 PDF는 OCR 처리 후 올려 주세요.')
    if sum(len(s['text']) for s in slides) > 250000:
        raise ValueError('선택 범위가 너무 깁니다. 페이지 범위를 나누어 주세요.')
    return {'total_slides': total, 'slides': slides}

if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else '문서 파일을 읽을 수 없습니다. PDF 처리에는 worker/requirements.txt 설치가 필요합니다.'}, ensure_ascii=False))
        sys.exit(1)
