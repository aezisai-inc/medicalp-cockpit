Feature: CloudFront pitch smoke
  Scenario: CloudFront happy path
    Given CloudFront distribution URL is healthy
    When presenter runs Scan then family switch then dual docs
    Then Daytona destroy is observed in trace
    And Sites iframe loads the same origin
