Feature: PHI egress guard
  Scenario: Partner payloads have no PHI strings
    Given a scan result that originally contained a patient name
    When Tavily or Daytona is invoked
    Then outbound JSON has no patient name or hospital name fields populated
