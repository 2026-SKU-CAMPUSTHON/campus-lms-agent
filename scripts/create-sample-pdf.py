"""공개 가능한 테스트 자료를 생성한다. 사용자의 강의 원본을 저장소에 복사하지 않는다."""
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

TEXTS = [
    'Database concepts. Tables store records. A primary key identifies one record.',
    'Normalization reduces duplication. A foreign key references another table.',
    'A transaction groups changes. Atomicity means all changes succeed or none do.',
    'An index speeds up lookups but requires extra storage.',
]
def create(path):
    writer = PdfWriter()
    for text in TEXTS:
        page = writer.add_blank_page(width=720, height=405)
        font = DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(('BT /F1 14 Tf 35 300 Td (' + text + ') Tj ET').encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'wb') as target: writer.write(target)
if __name__ == '__main__':
    path=Path(__file__).resolve().parents[1]/'tests/fixtures/generated/sample.pdf'
    create(path)
    print(path)
