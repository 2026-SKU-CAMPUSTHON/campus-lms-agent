"""PPTX 텍스트 추출. 표준 라이브러리만 사용하며 발표 순서와 페이지 번호를 보존한다."""
import json
import posixpath
import sys
import zipfile
from xml.etree import ElementTree as ET

P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

def extract(path, start, end):
    if not (1 <= start <= end):
        raise ValueError('페이지 범위를 확인해 주세요. 시작은 1 이상이며 끝보다 작거나 같아야 합니다.')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(i.file_size for i in entries) > 64 * 1024 * 1024:
            raise ValueError('압축 해제 크기가 허용 범위를 넘습니다. PPT를 나누어 올려 주세요.')
        if len({i.filename for i in entries}) != len(entries):
            raise ValueError('중복 경로가 있는 PPTX는 지원하지 않습니다.')
        def xml(name):
            data = archive.read(name)
            if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                raise ValueError('외부 엔티티가 포함된 XML은 지원하지 않습니다.')
            return ET.fromstring(data)
        presentation = xml('ppt/presentation.xml')
        relationships = xml('ppt/_rels/presentation.xml.rels')
        targets = {rel.attrib['Id']: rel.attrib['Target'] for rel in relationships
                   if rel.attrib.get('Type', '').endswith('/slide') and rel.attrib.get('TargetMode') != 'External'}
        order = presentation.find(P + 'sldIdLst')
        if order is None or end > len(order) or len(order) > 500:
            raise ValueError('페이지 범위가 PPT의 실제 페이지 수를 넘거나 PPT가 500페이지를 넘습니다.')
        slides = []
        for index, slide in enumerate(order, 1):
            if not start <= index <= end:
                continue
            target = targets.get(slide.attrib.get(R + 'id'))
            if not target:
                raise ValueError('슬라이드 연결 정보를 읽을 수 없습니다.')
            name = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'ppt/' + target)
            if not name.startswith('ppt/slides/') or not name.endswith('.xml'):
                raise ValueError('잘못된 슬라이드 경로입니다.')
            document = xml(name)
            # a:p 안의 표시 텍스트만 사용한다. 필드 속성·XML 메타데이터는 제외한다.
            paragraphs = [''.join(t.text or '' for t in p.iter(A+'t')).strip() for p in document.iter(A+'p')]
            text = '\n'.join(p for p in paragraphs if p)
            slides.append({'slide_no': index, 'text': text})
        if not any(s['text'].strip() for s in slides):
            raise ValueError('선택 범위에서 텍스트를 찾지 못했습니다. 이미지로만 된 슬라이드는 아직 지원하지 않습니다.')
        if sum(len(s['text']) for s in slides) > 250000:
            raise ValueError('선택 범위의 텍스트가 너무 깁니다. 페이지 범위를 나누어 주세요.')
        return {'total_slides': len(order), 'slides': slides}

if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else 'PPTX 파일 구조를 읽을 수 없습니다.'}, ensure_ascii=False))
        sys.exit(1)
