Feature: PsychDependency lock
  Scenario: HIGH lock excluded from AI batch
    Given resident meds including one with psych_dependency HIGH
    When clinician applies AI deprescribe plan
    Then the HIGH medication remains active
    And Daytona scoring excludes that medication from savings
