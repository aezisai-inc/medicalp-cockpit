Feature: ClosedRealm paper scan and PHI mask
  Scenario: Scan fixture paints black PHI boxes
    Given fixture image "paper-scan/souvenir-notebook-v1.jpg" and bbox json
    When clinician posts "/api/vision/scan"
    Then response preview has masked regions for each PHI bbox
    And anonymous JSON contains drugs and egfr without personal names
