Feature: Five stakeholder win relay
  Scenario: Pharmacist and doctor points relay with five-way win metrics
    Given audit run completed with pitch matrix applied
    When dual documents are generated for clinician locale ja
    Then form2 points note includes pharmacist 1000 and doctor 250
    And impact metrics show facility assist delta 1095 and cost delta 68400
    And fall risk improves from 88 toward 18 and fracture cost avoided at full pitch 150 man
