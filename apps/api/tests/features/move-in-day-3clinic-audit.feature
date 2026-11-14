Feature: Move-in day three-clinic audit
  Scenario: Service-apartment move-in day bundles nine meds from three clinics
    Given resident fixture for service-apartment move-in day pitch
    When audit run completes once
    Then nine medications are returned with three distinct clinic labels
    And recommendation matrix is stop 4 taper 2 continue 3
    And daily doses progress from 4 toward morning once and annual assists 1460 toward 365
