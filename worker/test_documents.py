import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from document_extract import extract

class DocumentTests(unittest.TestCase):
    def test_pptx_presentation_order_not_filename_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'slides.pptx'
            with zipfile.ZipFile(path,'w') as z:
                z.writestr('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>')
                z.writestr('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide10.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>')
                for name,text in [('slide10.xml','첫 페이지 & 강의'),('slide2.xml','두 번째 페이지')]:
                    z.writestr('ppt/slides/'+name,'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>'+escape(text)+'</a:t></a:r></a:p></p:sld>')
            result=extract(path,1,1)
            self.assertEqual(result['total_slides'],2)
            self.assertEqual(result['slides'],[{'slide_no':1,'text':'첫 페이지 & 강의'}])
            self.assertEqual(extract(path,2,2)['slides'][0]['text'],'두 번째 페이지')
            with self.assertRaises(ValueError):extract(path,1,3)
    def test_pdf_range_and_blank_scan(self):
        from pypdf import PdfWriter
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'blank.pdf'
            writer=PdfWriter();writer.add_blank_page(720,405)
            with open(path,'wb') as target:writer.write(target)
            with self.assertRaisesRegex(ValueError,'OCR'):extract(path,1,1)
            with self.assertRaises(ValueError):extract(path,2,3)
