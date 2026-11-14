Feature: Facility fee type label toggle
  Scenario: Output-based versus bundled fee labels do not change impact metrics
    Given impact metrics computed for the locked audit plan
    When facility fee type label toggles between output-based 80 percent and bundled 20 percent
    Then cost delta assist delta and fracture avoided values are unchanged
