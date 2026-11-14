Feature: AudienceMode informed consent
  Scenario: Family mode hides facility ROI lexicon
    Given an audit result with clinician copy containing facility ROI terms
    When audience switches to family
    Then response and UI contain 0 matches for "ぶった斬り" and "老健利益" and "100床"
    And gentle graduation calendar is emphasized

  Scenario: Audience tab switch does not re-call audit run
    Given audit run completed once with dual docs cached
    When audience switches between clinician and family tabs
    Then audit run endpoint is not invoked again
    And dual docs form2 and family sheet remain available from cache
