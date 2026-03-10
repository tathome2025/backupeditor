import unittest

from generator import estimate_duration_from_text, format_srt_timestamp, split_script_into_segments


class GeneratorUtilsTest(unittest.TestCase):
    def test_split_by_paragraphs(self):
        text = "步驟一：先拔掉插頭。\n\n步驟二：打開上蓋。\n\n步驟三：清洗濾網。"
        segments = split_script_into_segments(text, max_chars=50)
        self.assertEqual(len(segments), 3)
        self.assertTrue(segments[0].startswith("步驟一"))

    def test_split_long_sentence(self):
        text = "這是一段很長很長的教學說明，包含多個步驟與細節，需要在系統中被切分成多段，避免字幕一次顯示太多內容造成閱讀困難。"
        segments = split_script_into_segments(text, max_chars=24)
        self.assertGreaterEqual(len(segments), 2)
        self.assertTrue(all(len(s) <= 24 for s in segments))

    def test_srt_timestamp(self):
        self.assertEqual(format_srt_timestamp(62.345), "00:01:02,345")

    def test_duration_estimate_has_floor(self):
        self.assertGreaterEqual(estimate_duration_from_text("Hi"), 2.5)


if __name__ == "__main__":
    unittest.main()
