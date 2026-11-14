Feature: Dual documents
  Scenario: Dual docs payload returned together
    Given a locked audit plan
    When clinician opens dual documents
    Then API returns ClinicalDeprescribeOrder and FamilyCareSheet in one payload
