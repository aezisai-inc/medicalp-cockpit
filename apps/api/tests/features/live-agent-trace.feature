Feature: Live agent trace
  Scenario: Trace order and destroy recorded
    When a live audit run completes
    Then trace events include Vision, Mask, Tavily, CodeAF, Daytona.destroy in order
    And each event declares source fixture, live, or live-cache
