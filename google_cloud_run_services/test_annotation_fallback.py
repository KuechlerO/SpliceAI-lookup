#!/usr/bin/env python3
"""Tests for SpliceAI annotation-file exon coordinate conversion."""

import unittest


def structure_from_spliceai_annotation_row(row):
    """Mirror of server._structure_from_spliceai_annotation_row for unit testing."""
    exon_starts_1based = [int(s) + 1 for s in row["EXON_START"].rstrip(",").split(",") if s]
    exon_ends_1based = [int(s) for s in row["EXON_END"].rstrip(",").split(",") if s]
    return {
        "EXON_STARTS": exon_starts_1based,
        "EXON_ENDS": exon_ends_1based,
        "CDS_START": None,
        "CDS_END": None,
        "STRAND": row["STRAND"],
    }


class TestStructureFromSpliceaiAnnotationRow(unittest.TestCase):
    def test_converts_0based_exon_starts_to_1based(self):
        row = {
            "STRAND": "-",
            "EXON_START": "63342000,63342500,",
            "EXON_END": "63342100,63342600,",
        }
        result = structure_from_spliceai_annotation_row(row)
        self.assertEqual(result["EXON_STARTS"], [63342001, 63342501])
        self.assertEqual(result["EXON_ENDS"], [63342100, 63342600])
        self.assertEqual(result["STRAND"], "-")


if __name__ == "__main__":
    unittest.main()
